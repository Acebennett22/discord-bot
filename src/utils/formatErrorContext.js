// Format an error_logs.context value for display on the error detail
// page. The context column is stored as JSON and the MySQL driver hands
// it back as a parsed object, so rendering it straight into EJS printed
// "[object Object]". This normalises it to a display string instead:
// objects become pretty-printed JSON, JSON strings are parsed and
// pretty-printed, plain strings pass through, and null/empty values stay
// falsy so the template hides the Context section entirely.
function formatErrorContext(context) {
  if (context === null || context === undefined) return null;
  if (typeof context === 'string') {
    if (!context.trim()) return null;
    try {
      return JSON.stringify(JSON.parse(context), null, 2);
    } catch {
      return context;
    }
  }
  if (typeof context === 'object') {
    try {
      return JSON.stringify(context, null, 2);
    } catch {
      return String(context);
    }
  }
  return String(context);
}

module.exports = { formatErrorContext };
