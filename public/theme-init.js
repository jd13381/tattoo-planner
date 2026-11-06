// Applies the colour theme before the first paint (docs/adr/0021-light-theme.md). A classic,
// render-blocking script in <head>, because a module runs too late and an inline script would need
// a CSP exception (desktop/navigation.ts allows scripts from the own origin only). It repeats
// `resolveTheme` and `applyTheme` of src/ui/theme.ts; tests/theme.test.ts checks that both agree.
(function () {
  var theme = "system";
  try {
    var desktop = window.tattooDesktop && window.tattooDesktop.initialTheme;
    var stored = desktop || window.localStorage.getItem("theme");
    if (stored === "light" || stored === "dark" || stored === "system") theme = stored;
  } catch {
    // Blocked storage: follow the system.
  }
  var dark =
    theme === "dark" ||
    (theme === "system" && !!window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  var root = document.documentElement;
  root.classList.toggle("light", !dark);
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
})();
