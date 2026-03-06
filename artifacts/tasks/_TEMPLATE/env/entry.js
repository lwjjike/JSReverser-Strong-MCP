import "./env.js";
import "./polyfills.js";

let capture = {};

try {
  const captureModule = await import("./capture.json", {with: {type: "json"}});
  capture = captureModule.default ?? {};
} catch (error) {
  console.warn('[env] capture.json not loaded:', error instanceof Error ? error.message : String(error));
}

const targetScript = capture?.targetScript?.content;
const targetFunction = Array.isArray(capture?.runtimeEvidence)
  ? capture.runtimeEvidence.find((item) => typeof item?.functionName === 'string')?.functionName
  : undefined;

try {
  if (typeof targetScript === 'string' && targetScript.length > 0) {
    globalThis.eval(targetScript);
  } else {
    console.warn('[env] targetScript.content is empty');
  }

  if (targetFunction && typeof globalThis[targetFunction] === 'function') {
    console.log({
      targetFunction,
      result: globalThis[targetFunction]('token', 'nonce'),
    });
  } else {
    console.log({
      message: 'target function not callable yet',
      targetFunction,
    });
  }
} catch (error) {
  console.error('[env:first-divergence]', error);
}
