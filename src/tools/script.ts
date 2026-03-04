/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../third_party/index.js';
import type {JSHandle} from '../third_party/index.js';

import {ToolCategory} from './categories.js';
import {getJSHookRuntime} from './runtime.js';
import {defineTool} from './ToolDefinition.js';

// Default script evaluation timeout in milliseconds (30 seconds)
const DEFAULT_SCRIPT_TIMEOUT = 30000;

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

export const evaluateScript = defineTool({
  name: 'evaluate_script',
  description: `Evaluate a JavaScript function inside the currently selected page. Returns the response as JSON
so returned values have to JSON-serializable.`,
  annotations: {
    category: ToolCategory.DEBUGGING,
    readOnlyHint: false,
  },
  schema: {
    function: zod.string().describe(
      `A JavaScript function declaration to be executed by the tool in the currently selected page.
Example without arguments: \`() => {
  return document.title
}\` or \`async () => {
  return await fetch("example.com")
}\`.
Example with arguments: \`(el) => {
  return el.innerText;
}\`
`,
    ),
  },
  handler: async (request, response, context) => {
    let fn: JSHandle<unknown> | undefined;
    try {
      const frame = context.getSelectedFrame();
      fn = await withTimeout(
        frame.evaluateHandle(`(${request.params.function})`),
        DEFAULT_SCRIPT_TIMEOUT,
        'Script evaluation timed out',
      );
      await context.waitForEventsAfterAction(async () => {
        const result = await withTimeout(
          frame.evaluate(async fn => {
            // @ts-expect-error no types.
            return JSON.stringify(await fn());
          }, fn),
          DEFAULT_SCRIPT_TIMEOUT,
          'Script execution timed out',
        );
        response.appendResponseLine('Script ran on page and returned:');
        response.appendResponseLine('```json');
        response.appendResponseLine(`${result}`);
        response.appendResponseLine('```');
      });
    } finally {
      if (fn) {
        void fn.dispose();
      }
    }
  },
});

export const injectPreloadScript = defineTool({
  name: 'inject_preload_script',
  description:
    'Register a JavaScript snippet that will run on future document loads before page scripts execute. Use this for preload hooks, environment patches, and early instrumentation.',
  annotations: {
    category: ToolCategory.DEBUGGING,
    readOnlyHint: false,
  },
  schema: {
    script: zod.string().describe('JavaScript source to register for future document loads.'),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    await runtime.pageController.injectScriptOnNewDocument(request.params.script);
    response.appendResponseLine('Preload script registered for future documents.');
  },
});
