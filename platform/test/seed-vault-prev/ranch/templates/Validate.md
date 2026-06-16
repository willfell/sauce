<%* const result = await tp.user.validate({ file: app.workspace.getActiveFile() });
if (!result.violations.length) { new Notice("validate: clean", 4000); }
else { new Notice(`validate: ${result.violations.length} violation(s) — see console`, 6000);
       console.log("[validate]", result.violations); } %>
