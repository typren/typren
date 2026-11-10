/**
 * House-style lint rules, loaded by .oxlintrc.json as a JS plugin.
 *
 * no-emdash-comments: comments are complete sentences and never use an em
 * dash (U+2014). Rewrite with a comma, colon, semicolon, period, or
 * parentheses. Strings are not checked: UI copy and error messages own their
 * own punctuation.
 */
export default {
  meta: { name: "typren" },
  rules: {
    "no-emdash-comments": {
      meta: {
        type: "suggestion",
        docs: { description: "disallow em dashes in comments" },
        schema: [],
        messages: { emdash: "No em dashes in comments. Use a comma, colon, semicolon, period, or parentheses." },
      },
      create(context) {
        return {
          Program() {
            for (const comment of context.sourceCode.getAllComments()) {
              if (comment.value.includes("—")) {
                context.report({ loc: comment.loc, messageId: "emdash" });
              }
            }
          },
        };
      },
    },
  },
};
