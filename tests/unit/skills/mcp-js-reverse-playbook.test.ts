import assert from 'node:assert';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {describe, it} from 'node:test';

const repoRoot = process.cwd();

async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

describe('mcp-js-reverse-playbook docs contract', () => {
  it('defines the staged workflow, principles, task artifacts, and local rebuild references', async () => {
    const skill = await readRepoFile('skills/mcp-js-reverse-playbook/SKILL.md');
    const automationEntry = await readRepoFile('skills/mcp-js-reverse-playbook/references/automation-entry.md');
    const taskTemplate = await readRepoFile('skills/mcp-js-reverse-playbook/references/mcp-task-template.md');
    const outputContract = await readRepoFile('skills/mcp-js-reverse-playbook/references/output-contract.md');
    const fallbacks = await readRepoFile('skills/mcp-js-reverse-playbook/references/fallbacks.md');
    const taskArtifacts = await readRepoFile('skills/mcp-js-reverse-playbook/references/task-artifacts.md');
    const localRebuild = await readRepoFile('skills/mcp-js-reverse-playbook/references/local-rebuild.md');

    for (const phrase of [
      'Observe',
      'Capture',
      'Rebuild',
      'Patch',
      'DeepDive',
      'Observe-first',
      'Hook-preferred',
      'Breakpoint-last',
      'Rebuild-oriented',
      'Evidence-first',
    ]) {
      assert.ok(skill.includes(phrase), `missing phrase in skill: ${phrase}`);
    }

    assert.ok(automationEntry.includes('页面观察'));
    assert.ok(taskTemplate.includes('本地补环境'));
    assert.ok(outputContract.includes('task artifact'));
    assert.ok(fallbacks.includes('local rebuild'));
    assert.ok(taskArtifacts.includes('timeline.jsonl'));
    assert.ok(localRebuild.includes('env/entry.js'));
  });
});
