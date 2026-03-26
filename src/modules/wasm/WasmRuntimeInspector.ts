import type {
  WasmBodyKind,
  WasmBodyPathAnalysis,
  WasmBodySegmentHint,
  WasmBoundaryChain,
  WasmBoundaryStep,
  WasmExportEntry,
  WasmHeaderEntry,
  WasmKeyValuePreview,
  WasmModuleRecord,
  WasmRuntimeEvent,
  WasmSignatureDiffFieldChange,
  WasmSignatureDiffResult,
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

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))];
}

function normalizeHeaderName(name: string): string {
  return name.trim().toLowerCase();
}

function maskHeaderValue(value: string): string {
  if (value.length <= 8) {
    return `${value.slice(0, 2)}***`;
  }
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function isSensitiveHeader(name: string, value: string): boolean {
  return /(authorization|signature|token|secret|key|cookie)/i.test(name) || value.length >= 24;
}

function classifyBodyKind(value?: string): WasmBodyKind {
  const trimmed = (value ?? '').trim();
  if (trimmed.length === 0) {
    return 'empty';
  }
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    return 'json';
  }
  if (trimmed.includes('=') && trimmed.includes('&')) {
    return 'urlencoded';
  }
  if (/^[0-9a-f]+$/i.test(trimmed) && trimmed.length >= 16) {
    return 'hexish';
  }
  if (/^[A-Za-z0-9+/=_-]+$/.test(trimmed) && trimmed.length >= 16) {
    return 'base64ish';
  }
  if (trimmed.length > 0) {
    return 'plain-text';
  }
  return 'unknown';
}

function splitBodySegments(bodySnippet?: string, bodyKind?: WasmBodyKind): WasmBodySegmentHint[] {
  const body = bodySnippet ?? '';
  const kind = bodyKind ?? classifyBodyKind(body);
  const parts: string[] =
    kind === 'json'
      ? Object.keys(safeParseJson(body))
      : kind === 'urlencoded'
        ? body.split('&').map((entry) => entry.split('=').slice(1).join('=') || entry)
        : body.includes('.')
          ? body.split('.')
          : body.includes(':')
            ? body.split(':')
            : body.length > 0
              ? [body]
              : [];

  return parts
    .map((raw, index) => {
      const value = raw.trim();
      const classification = classifySegment(value);
      const likelySignatureMaterial =
        /(sign|signature|token|nonce|hmac|digest)/i.test(value) ||
        classification === 'base64ish' ||
        classification === 'hexish';
      const masked = likelySignatureMaterial && value.length >= 12;
      return {
        index,
        raw: value,
        displayValue: masked ? maskHeaderValue(value) : value,
        classification,
        likelySignatureMaterial,
      };
    })
    .filter((entry) => entry.raw.length > 0);
}

function safeParseJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore parse errors.
  }
  return {};
}

function classifySegment(value: string): WasmBodySegmentHint['classification'] {
  if (value.length === 0) {
    return 'empty';
  }
  if (/^\d+$/.test(value)) {
    return 'numeric';
  }
  if (/^[0-9a-f]+$/i.test(value) && value.length >= 16) {
    return 'hexish';
  }
  if (/^[A-Za-z0-9+/=_-]+$/.test(value) && value.length >= 16) {
    return 'base64ish';
  }
  if ((value.startsWith('{') && value.endsWith('}')) || value.includes('":')) {
    return 'json';
  }
  if (value.includes('=') && value.includes('&')) {
    return 'urlencoded';
  }
  return 'plain-text';
}

function parseUrlDetails(url?: string): {
  queryOrder?: string;
  queryValues: Map<string, string[]>;
} {
  if (!url) {
    return {
      queryValues: new Map(),
    };
  }
  try {
    const parsed = new URL(url);
    const queryValues = new Map<string, string[]>();
    for (const [key, value] of parsed.searchParams.entries()) {
      const values = queryValues.get(key) ?? [];
      values.push(value);
      queryValues.set(key, values);
    }
    return {
      queryOrder: parsed.search ? parsed.search.slice(1) : undefined,
      queryValues,
    };
  } catch {
    return {
      queryValues: new Map(),
    };
  }
}

function dedupeHeaders(entries: WasmHeaderEntry[]): WasmHeaderEntry[] {
  const byName = new Map<string, WasmHeaderEntry>();
  for (const entry of entries) {
    const key = normalizeHeaderName(entry.name);
    if (!byName.has(key)) {
      byName.set(key, entry);
    }
  }
  return Array.from(byName.values());
}

function dedupeKeyValue(entries: WasmKeyValuePreview[]): WasmKeyValuePreview[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.key}:${entry.value}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
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
      const bodyAnalysis = this.buildBodyAnalysis(writerEvents, readerEvents, sinkEvents);
      const headerCandidates = dedupeHeaders([
        ...sinkEvents.flatMap((candidate) => candidate.requestHeaders ?? []),
        ...((event.resultEntries ?? []).map((entry) => ({
          name: entry.key,
          value: entry.value,
          masked: entry.masked,
        }))),
      ]);
      const returnValueHints = dedupeKeyValue(event.resultEntries ?? []);

      const steps: WasmBoundaryStep[] = related
        .map((candidate) => this.toStep(candidate))
        .sort((a, b) => a.timestamp - b.timestamp);

      const score =
        writerEvents.length * 2 +
        readerEvents.length * 2 +
        sinkEvents.length * 3 +
        (writerEvents.some((candidate) => candidate.type === 'text_encode') ? 2 : 0) +
        (readerEvents.some((candidate) => candidate.type === 'text_decode') ? 2 : 0) +
        (sinkEvents.length > 0 ? 2 : 0) +
        (bodyAnalysis.segments.some((segment) => segment.likelySignatureMaterial) ? 2 : 0) +
        (headerCandidates.length > 0 ? 1 : 0);

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
        headerCandidates,
        returnValueHints,
        bodyAnalysis,
        networkTargets: sinkEvents.map((candidate) => ({
          method: candidate.method,
          url: candidate.url,
          bodySnippet: candidate.bodySnippet,
          bodyKind: candidate.bodyKind,
          requestHeaders: candidate.requestHeaders ? [...candidate.requestHeaders] : undefined,
        })),
        steps,
      });
    }

    return chains.sort((a, b) => b.score - a.score || b.endedAt - a.endedAt);
  }

  buildStructuredBoundaryArtifact(modules: WasmModuleRecord[], events: WasmRuntimeEvent[]): {
    generatedAt: string;
    modules: Array<{
      moduleId: string;
      hash: string;
      boundary: ReturnType<WasmRuntimeInspector['summarizeBoundary']>;
      exportUsage: WasmExportUsageSummary[];
    }>;
  } {
    return {
      generatedAt: new Date().toISOString(),
      modules: modules.map((module) => ({
        moduleId: module.id,
        hash: module.hash,
        boundary: this.summarizeBoundary(module, events),
        exportUsage: this.summarizeExports(module, events),
      })),
    };
  }

  analyzeSignatureDiff(
    module: WasmModuleRecord,
    events: WasmRuntimeEvent[],
    options: {
      exportName?: string;
      maxChains?: number;
    } = {},
  ): WasmSignatureDiffResult {
    const chains = this.buildBoundaryChains(module, events)
      .filter((chain) => !options.exportName || chain.exportName === options.exportName)
      .filter((chain) => chain.networkTargets.length > 0)
      .slice(0, options.maxChains ?? 12);

    const changedFields: WasmSignatureDiffFieldChange[] = [];
    const observations: string[] = [];

    const queryOrderValues = new Set<string>();
    const queryFields = new Map<string, Set<string>>();
    const headerFields = new Map<string, Set<string>>();
    const bodyFields = new Map<string, Set<string>>();

    for (const chain of chains) {
      const target = chain.networkTargets[0];
      const urlDetails = parseUrlDetails(target?.url);
      if (urlDetails.queryOrder) {
        queryOrderValues.add(urlDetails.queryOrder);
      }
      for (const [key, values] of urlDetails.queryValues.entries()) {
        const set = queryFields.get(key) ?? new Set<string>();
        for (const value of values) {
          set.add(value);
        }
        queryFields.set(key, set);
      }
      for (const header of target?.requestHeaders ?? []) {
        const key = normalizeHeaderName(header.name);
        const set = headerFields.get(key) ?? new Set<string>();
        set.add(header.value);
        headerFields.set(key, set);
      }
      const segments = chain.bodyAnalysis?.segments ?? splitBodySegments(target?.bodySnippet, target?.bodyKind);
      for (const segment of segments) {
        const key = `segment_${segment.index}`;
        const set = bodyFields.get(key) ?? new Set<string>();
        set.add(segment.raw);
        bodyFields.set(key, set);
      }
    }

    if (queryOrderValues.size > 1) {
      changedFields.push({
        field: 'query-order',
        location: 'url-query-order',
        variationCount: queryOrderValues.size,
        examples: Array.from(queryOrderValues).slice(0, 4),
        impact: 'contextual',
        notes: 'Observed different raw query-string ordering across boundary chains.',
      });
      observations.push('URL query parameter order changes across captured boundary chains.');
    }

    for (const [field, values] of queryFields.entries()) {
      if (values.size <= 1) {
        continue;
      }
      const impact: WasmSignatureDiffFieldChange['impact'] =
        /(timestamp|nonce|sign|signature|token)/i.test(field) ? 'signature-candidate' : 'contextual';
      changedFields.push({
        field,
        location: 'url-query',
        variationCount: values.size,
        examples: Array.from(values).slice(0, 4),
        impact,
        notes: impact === 'signature-candidate'
          ? 'This query key looks directly related to freshness or signature material.'
          : 'This query key changed across observed request variants.',
      });
    }

    for (const [field, values] of headerFields.entries()) {
      if (values.size <= 1) {
        continue;
      }
      const impact: WasmSignatureDiffFieldChange['impact'] =
        /(signature|timestamp|token|authorization)/i.test(field) ? 'signature-candidate' : 'transport-only';
      changedFields.push({
        field,
        location: 'request-header',
        variationCount: values.size,
        examples: Array.from(values).slice(0, 4).map((value) =>
          isSensitiveHeader(field, value) ? maskHeaderValue(value) : value,
        ),
        impact,
        notes: impact === 'signature-candidate'
          ? 'Header value shifts look consistent with runtime signature generation.'
          : 'Header value variation looks more transport/context oriented.',
      });
    }

    for (const [field, values] of bodyFields.entries()) {
      if (values.size <= 1) {
        continue;
      }
      const examples = Array.from(values).slice(0, 4);
      const impact: WasmSignatureDiffFieldChange['impact'] =
        examples.some((value) => /^[0-9a-f]{16,}$/i.test(value) || /^[A-Za-z0-9+/=_-]{16,}$/.test(value))
          ? 'signature-candidate'
          : 'contextual';
      changedFields.push({
        field,
        location: 'body-segment',
        variationCount: values.size,
        examples: examples.map((value) => (impact === 'signature-candidate' ? maskHeaderValue(value) : value)),
        impact,
        notes: impact === 'signature-candidate'
          ? 'Body segment value looks like an encoded digest or token.'
          : 'Body segment varies, but does not look directly like a digest.',
      });
    }

    if (changedFields.some((field) => field.impact === 'signature-candidate')) {
      observations.push('At least one varying header/body/query field looks like candidate signature material.');
    }
    if (chains.some((chain) => chain.bodyAnalysis?.segments.some((segment) => segment.likelySignatureMaterial))) {
      observations.push('Body-path tracing observed encoded-looking segments after Wasm export calls.');
    }
    if (observations.length === 0) {
      observations.push('No strong differential signal was found from the captured Wasm boundary chains.');
    }

    return {
      moduleId: module.id,
      exportName: options.exportName,
      sampleCount: chains.length,
      comparedChains: chains.length,
      observations,
      changedFields,
    };
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
      lines.push(`- Import namespaces: ${boundary.importNamespaces.join(', ') || 'none'}`);
      lines.push(`- Top exports: ${boundary.topExports.join(', ') || 'none'}`);
      lines.push(`- Side effects: ${boundary.sideEffectHints.join(', ') || 'not observed'}`);
      if (boundary.candidateChains.length > 0) {
        lines.push('- Boundary chains:');
        for (const chain of boundary.candidateChains.slice(0, 3)) {
          lines.push(
            `  - ${chain.exportName}: score=${chain.score}, writers=${chain.writerHints.join('; ') || 'none'}, readers=${chain.readerHints.join('; ') || 'none'}, sinks=${chain.sinkHints.join('; ') || 'none'}`,
          );
          if (chain.bodyAnalysis && chain.bodyAnalysis.segments.length > 0) {
            lines.push(
              `    body=${chain.bodyAnalysis.bodyKind}; segments=${chain.bodyAnalysis.segments.map((segment) => segment.displayValue).join(' | ')}`,
            );
          }
          if (chain.headerCandidates.length > 0) {
            lines.push(
              `    headers=${chain.headerCandidates.map((entry) => `${entry.name}=${entry.value}`).join('; ')}`,
            );
          }
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

  private buildBodyAnalysis(
    writerEvents: WasmRuntimeEvent[],
    readerEvents: WasmRuntimeEvent[],
    sinkEvents: WasmRuntimeEvent[],
  ): WasmBodyPathAnalysis {
    const sink = sinkEvents[0];
    const bodyKind = sink?.bodyKind ?? classifyBodyKind(sink?.bodySnippet);
    const segments =
      sink?.bodySegments && sink.bodySegments.length > 0
        ? sink.bodySegments.map((segment) => ({...segment}))
        : splitBodySegments(sink?.bodySnippet, bodyKind);
    const hints = uniqueStrings([
      bodyKind !== 'unknown' ? `body-kind:${bodyKind}` : undefined,
      writerEvents.some((event) => event.type === 'text_encode') ? 'text-encode-before-network' : undefined,
      readerEvents.some((event) => event.type === 'text_decode') ? 'text-decode-after-export' : undefined,
      segments.some((segment) => segment.likelySignatureMaterial) ? 'encoded-body-segment-observed' : undefined,
    ]);
    return {
      bodyKind,
      segments,
      hints,
      candidateWriters: writerEvents
        .flatMap((event) => event.argsPreview ?? [])
        .filter((entry) => typeof entry === 'string')
        .slice(0, 6),
      candidateReaders: readerEvents
        .flatMap((event) => event.argsPreview ?? [])
        .filter((entry) => typeof entry === 'string')
        .slice(0, 6),
    };
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
      bodySnippet: event.bodySnippet,
      bodyKind: event.bodyKind,
      requestHeaders: event.requestHeaders ? [...event.requestHeaders] : undefined,
      resultEntries: event.resultEntries ? [...event.resultEntries] : undefined,
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
