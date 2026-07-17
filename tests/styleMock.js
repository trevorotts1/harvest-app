// Jest stub for CSS-module imports (T-20). A CSS-module default import (`import styles from
// './x.module.css'`) resolves to this proxy: `styles.anyClass` returns the string `'anyClass'`,
// so component class names remain visible in `react-dom/server` output for the onboarding UI
// assertions. There is no CSS transform in the node test environment; this keeps the import from
// being parsed as JavaScript (which would be a syntax error).
module.exports = new Proxy(
  {},
  {
    get: (_target, key) => {
      if (key === '__esModule') return false;
      if (typeof key === 'symbol') return undefined;
      return String(key);
    },
  }
);
