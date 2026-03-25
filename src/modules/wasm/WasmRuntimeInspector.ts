import type {
  WasmBoundaryChain,
  WasmBoundaryStep,
  WasmExportEntry,
  WasmModuleRecord,
  WasmRuntimeEvent,
} from './WasmTypes.js';

interface WasmExportUsageSummary {
  name: string;
  kind: WasmExportEntry['kind'];
  callCount: number;
  params?: WasmExportEntry['params'];
  results?: WasmExportEntry['results'];
  suspicion: 'high' | 'medium' | 'low';
  reasons: string[];
}

export class WasmRuntimeInspector {
  summarizeExports(
    module: WasmModuleRecord,
    events: WasmRuntimeEvent[],
  ): WasmExportUsageSummary[] {
    const relevantEvents = events.filter((event) => event.moduleId === module.id);
    const callCounts = new Map<string, number>();
    for (const event of relevantEvents) {
      if (event.type !== 'export_call' || !event.exportName) {
        continue;
      }
      callCounts.set(event.exportName, (callCounts.get(event.exportName) ?? 0) + 1);
    }

    return module.exports
      .map((entry) => {
        const callCount = callCounts.get(entry.name) ?? entry.callCount ?? 0;
        const reasons: string[] = [];
        if (callCount >= 5) {
          reasons.push('high runtime call count');
        }
        if (/(sign|sha|aes|sm3|sm4|md5|encrypt|decrypt|token|nonce)/i.test(entry.name)) {
          reasons.push('name matches signature/crypto keywords');
        }
        if ((entry.params?.length ?? 0) >= 2 && (entry.results?.length ?? 0) <= 1) {
          reasons.push('shape looks like transform routine');
        }
        let suspicion: 'high' | 'medium' | 'low' = 'low';
        if (reasons.length >= 2 || callCount >= 10) {
          suspicion = 'high';
        } else if (reasons.length === 1 || callCount >= 3) {
          suspicion = 'medium';
        }
        return {
          name: entry.name,
          kind: entry.kind,
          callCount,
          params: entry.params,
          results: entry.results,
          suspicion,
          reasons,
        };
      })
      .sort((a, b) => b.callCount - a.callCount || a.name.localeCompare(b.name));
  }

  summarizeBoundary(
    module: WasmModuleRecord,
    events: WasmRuntimeEvent[],
  ): {
    importNamespaces: string[];
    topExports: string[];
    stackSamples: string[][];
    sideEffectHints: string[];
    candidateChains: WasmBoundaryChain[];
  } {
    const relevantEvents = events.filter((event) => event.moduleId === module.id);
    const instantiateEvents = relevantEvents.filter((event) => event.type !== 'export_call');
    const exportUsage = this.summarizeExports(module, events).slice(0, 5);
    const candidateChains = this.buildBoundaryChains(module, events).slice(0, 5);
    return {
      importNamespaces: [...new Set(module.imports.map((entry) => entry.module))],
      topExports: exportUsage.map((entry) => entry.name),
      stackSamples: instantiateEvents
        .map((event) => event.stackSummary ?? [])
        .filter((stack) => stack.length > 0)
        .slice(0, 3),
      sideEffectHints: [
        ...new Set(
          relevantEvents.flatMap((event) => event.sideEffectHints ?? []),
        ),
      ],
      candidateChains,
    };
  }

  buildBoundaryChains(
    module: WasmModuleRecord,
    events: WasmRuntimeEvent[],
  ): WasmBoundaryChain[] {
    const relevantEvents = events
      .filter((event) => event.moduleId === module.id)
      .sort((a, b) => a.timestamp - b.timestamp);
    const chains: WasmBoundaryChain[] = [];

    for (const event of relevantEvents) {
      if (event.type !== 'export_call' || !event.exportName) {
        continue;
      }

      const runtimeModuleId = event.runtimeModuleId;
      const windowStart = event.timestamp - 1500;
      const windowEnd = event.timestamp + 2500;
      const related = relevantEvents.filter((candidate) => {
        if (candidate.timestamp < windowStart || candidate.timestamp > windowEnd) {
          return false;
        }
        if (!runtimeModuleId || !candidate.runtimeModuleId) {
          return true;
        }
        return candidate.runtimeModuleId === runtimeModuleId;
      });

      const before = related.filter((candidate) => candidate.timestamp <= event.timestamp);
      const after = related.filter((candidate) => candidate.timestamp >= event.timestamp);

      const writerEvents = before.filter((candidate) =>
        candidate.type === 'memory_write' ||
        candidate.type === 'text_encode' ||
        candidate.type === 'memory_view_create' ||
        candidate.type === 'memory_buffer_access',
      );
      const readerEvents = after.filter((candidate) =>
        candidate.type === 'memory_read' ||
        candidate.type === 'text_decode',
      );
      const sinkEvents = after.filter((candidate) => candidate.type === 'network_request');

      const writerHints = [...new Set(writerEvents.map((candidate) => this.describeHint(candidate)).filter(Boolean))];
      const readerHints = [...new Set(readerEvents.map((candidate) => this.describeHint(candidate)).filter(Boolean))];
      const sinkHints = [...new Set(sinkEvents.map((candidate) => this.describeSink(candidate)).filter(Boolean))];
      const candidateJsCallers = [
        ...new Set(
          related
            .flatMap((candidate) => candidate.stackSummary ?? [])
            .filter((line) => !line.includes('WebAssembly.') && !line.includes('at wrappedExports')),
        ),
      ].slice(0, 6);

      const steps: WasmBoundaryStep[] = related
        .map((candidate) => this.toStep(candidate))
        .sort((a, b) => a.timestamp - b.timestamp);

      const score =
        writerEvents.length * 2 +
        readerEvents.length * 2 +
        sinkEvents.length * 3 +
        (writerEvents.some((candidate) => candidate.type === 'text_encode') ? 2 : 0) +
        (readerEvents.some((candidate) => candidate.type === 'text_decode') ? 2 : 0) +
        (sinkEvents.length > 0 ? 2 : 0);

      chains.push({
        moduleId: module.id,
        runtimeModuleId,
        exportName: event.exportName,
        score,
        startedAt: steps[0]?.timestamp ?? event.timestamp,
        endedAt: steps[steps.length - 1]?.timestamp ?? event.timestamp,
        writerHints,
        readerHints,
        sinkHints,
        candidateJsCallers,
        networkTargets: sinkEvents.map((candidate) => ({
          method: candidate.method,
          url: candidate.url,
          bodySnippet: candidate.bodySnippet,
        })),
        steps,
      });
    }

    return chains.sort((a, b) => b.score - a.score || b.endedAt - a.endedAt);
  }

  buildBoundaryReport(modules: WasmModuleRecord[], events: WasmRuntimeEvent[]): string {
    const lines: string[] = ['# Wasm Boundary Report', ''];
    if (modules.length === 0) {
      lines.push('No Wasm modules captured in the current session.');
      return lines.join('\n');
    }

    for (const module of modules) {
      const boundary = this.summarizeBoundary(module, events);
      const exportUsage = this.summarizeExports(module, events).slice(0, 5);

      lines.push(`## ${module.id}`);
      lines.push(`- Hash: ${module.hash}`);
      lines.push(`- Load methods: ${module.loadMethods.join(', ')}`);
      lines.push(
        `- Import namespaces: ${boundary.importNamespaces.join(', ') || 'none'}`,
      );
      lines.push(
        `- Top exports: ${boundary.topExports.join(', ') || 'none'}`,
      );
      lines.push(
        `- Side effects: ${boundary.sideEffectHints.join(', ') || 'not observed'}`,
      );
      if (boundary.candidateChains.length > 0) {
        lines.push('- Boundary chains:');
        for (const chain of boundary.candidateChains.slice(0, 3)) {
          lines.push(
            `  - ${chain.exportName}: score=${chain.score}, writers=${chain.writerHints.join('; ') || 'none'}, readers=${chain.readerHints.join('; ') || 'none'}, sinks=${chain.sinkHints.join('; ') || 'none'}`,
          );
        }
      }
      if (exportUsage.length > 0) {
        lines.push('- Export usage:');
        for (const usage of exportUsage) {
          lines.push(
            `  - ${usage.name}: calls=${usage.callCount}, suspicion=${usage.suspicion}${usage.reasons.length > 0 ? ` (${usage.reasons.join('; ')})` : ''}`,
          );
        }
      }
      if (boundary.stackSamples.length > 0) {
        lines.push('- Stack samples:');
        for (const stack of boundary.stackSamples) {
          lines.push(`  - ${stack.join(' | ')}`);
        }
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  private describeHint(event: WasmRuntimeEvent): string {
    switch (event.type) {
      case 'memory_buffer_access':
        return `buffer access on ${event.memoryExportName ?? 'memory'}`;
      case 'memory_view_create':
        return `${event.viewType ?? 'TypedArray'} view @${event.byteOffset ?? 0}:${event.byteLength ?? 0}`;
      case 'memory_write':
        return `${event.viewType ?? 'view'} write @${event.byteOffset ?? 0}:${event.byteLength ?? 0}`;
      case 'memory_read':
        return `${event.viewType ?? 'view'} read @${event.byteOffset ?? 0}:${event.byteLength ?? 0}`;
      case 'text_encode':
        return `TextEncoder -> ${event.viewType ?? 'view'}`;
      case 'text_decode':
        return `TextDecoder <- ${event.viewType ?? 'view'}`;
      default:
        return '';
    }
  }

  private describeSink(event: WasmRuntimeEvent): string {
    if (event.type !== 'network_request') {
      return '';
    }
    return `${event.method ?? 'UNKNOWN'} ${event.url ?? 'unknown-url'}`;
  }

  private toStep(event: WasmRuntimeEvent): WasmBoundaryStep {
    return {
      type: event.type,
      timestamp: event.timestamp,
      description: this.describeStep(event),
      exportName: event.exportName,
      memoryExportName: event.memoryExportName,
      url: event.url,
      method: event.method,
      stackSummary: event.stackSummary ? [...event.stackSummary] : undefined,
    };
  }

  private describeStep(event: WasmRuntimeEvent): string {
    switch (event.type) {
      case 'export_call':
        return `call export ${event.exportName ?? 'unknown'}`;
      case 'memory_buffer_access':
        return `access ${event.memoryExportName ?? 'memory'}.buffer`;
      case 'memory_view_create':
        return `create ${event.viewType ?? 'view'} over wasm memory`;
      case 'memory_write':
        return `write via ${event.viewType ?? 'view'}`;
      case 'memory_read':
        return `read via ${event.viewType ?? 'view'}`;
      case 'text_encode':
        return 'encode text into wasm-backed memory';
      case 'text_decode':
        return 'decode text from wasm-backed memory';
      case 'network_request':
        return `network sink ${event.method ?? 'UNKNOWN'} ${event.url ?? 'unknown-url'}`;
      default:
        return event.type;
    }
  }
}
