const METHOD_NAMES = Object.freeze([
  "launch_app",
  "activate_window",
  "click",
  "type_text",
  "press_key",
  "get_state",
  "observe",
  "scroll",
  "drag",
]);

export function createFakeSky({ onInvoke } = {}) {
  const calls = [];
  const configuredErrors = new Map();
  let invocationOrder = 0;
  let sky;

  const methods = Object.fromEntries(
    METHOD_NAMES.map((methodName) => [
      methodName,
      async function (...args) {
        invocationOrder += 1;
        const configuredError = configuredErrors.get(methodName);
        const thisBindingCorrect = this === sky;
        const record = Object.freeze({
          method_name: methodName,
          invocation_order: invocationOrder,
          argument_count: args.length,
          return_value: `RETURN_${methodName}`,
          error_behavior: configuredError
            ? "THROW_CONFIGURED_ERROR"
            : thisBindingCorrect
              ? "NONE"
              : "THROW_THIS_BINDING_ERROR",
        });
        calls.push(record);
        onInvoke?.(record);

        if (!thisBindingCorrect) {
          throw new Error("THIS_BINDING_ERROR");
        }
        if (configuredError) {
          throw configuredError;
        }

        return Object.freeze({
          method_name: methodName,
          safe_return_value: record.return_value,
        });
      },
    ]),
  );

  sky = Object.assign(
    {
      target: "fake-windows",
    },
    methods,
  );

  return Object.freeze({
    calls,
    sky,
    setError(methodName, error) {
      if (!METHOD_NAMES.includes(methodName)) {
        throw new RangeError("Unknown fake method");
      }
      configuredErrors.set(methodName, error);
    },
  });
}
