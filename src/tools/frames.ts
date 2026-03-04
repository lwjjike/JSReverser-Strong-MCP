/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../third_party/index.js';
import {zod} from '../third_party/index.js';

import {ToolCategory} from './categories.js';
import {defineTool} from './ToolDefinition.js';

function getFrameDepth(frame: Frame): number {
  let depth = 0;
  let parent = frame.parentFrame();
  while (parent) {
    depth += 1;
    parent = parent.parentFrame();
  }
  return depth;
}

export const listFrames = defineTool({
  name: 'list_frames',
  description:
    'Lists all frames (including iframes) in the current page as a tree. Shows frame index, name, and URL. Use select_frame to switch execution context to a specific frame.',
  annotations: {
    title: 'List Frames',
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (_request, response, context) => {
    const page = context.getSelectedPage();
    const frames = page.frames();
    const currentFrame = context.getSelectedFrame();

    if (frames.length === 0) {
      response.appendResponseLine('No frames found.');
      return;
    }

    response.appendResponseLine(`Frames (${frames.length} total):\n`);

    for (let i = 0; i < frames.length; i += 1) {
      const frame = frames[i];
      const indent = '  '.repeat(getFrameDepth(frame));
      const marker = frame === currentFrame ? ' [selected]' : '';
      const name = frame.name() ? ` name="${frame.name()}"` : '';
      response.appendResponseLine(
        `${indent}${i}: ${frame.url() || '(empty)'}${name}${marker}`,
      );
    }
  },
});

export const selectFrame = defineTool({
  name: 'select_frame',
  description:
    'Selects a frame (by index from list_frames) as the execution context for evaluate_script, hook_function, inspect_object, and other tools that run JavaScript in the page.',
  annotations: {
    title: 'Select Frame',
    category: ToolCategory.DEBUGGING,
    readOnlyHint: false,
  },
  schema: {
    frameIdx: zod
      .number()
      .int()
      .min(0)
      .describe('The frame index from list_frames. 0 = main frame.'),
  },
  handler: async (request, response, context) => {
    const page = context.getSelectedPage();
    const frames = page.frames();
    const {frameIdx} = request.params;

    if (frameIdx >= frames.length) {
      response.appendResponseLine(
        `Invalid frame index ${frameIdx}. Use list_frames to see available frames (0-${frames.length - 1}).`,
      );
      return;
    }

    const frame = frames[frameIdx];
    if (frameIdx === 0) {
      context.resetSelectedFrame();
      response.appendResponseLine('Switched to main frame.');
      return;
    }

    context.selectFrame(frame);
    const name = frame.name() ? ` (name: "${frame.name()}")` : '';
    response.appendResponseLine(
      `Switched to frame ${frameIdx}: ${frame.url()}${name}`,
    );
  },
});
