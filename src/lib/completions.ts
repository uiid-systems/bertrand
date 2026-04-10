import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { paths } from "./paths.ts";

const COMMANDS = [
  "init",
  "list",
  "log",
  "stats",
  "archive",
  "update",
  "serve",
  "mcp",
  "import",
  "completion",
  "badge",
  "notify",
];

function bashCompletion(): string {
  return `# bertrand bash completion
_bertrand() {
  local cur=\${COMP_WORDS[COMP_CWORD]}
  COMPREPLY=( $(compgen -W "${COMMANDS.join(" ")}" -- "$cur") )
}
complete -F _bertrand bertrand
`;
}

function zshCompletion(): string {
  return `#compdef bertrand
# bertrand zsh completion
_bertrand() {
  local -a commands
  commands=(
${COMMANDS.map((c) => `    '${c}:${c} command'`).join("\n")}
  )
  _describe 'command' commands
}
_bertrand "$@"
`;
}

function fishCompletion(): string {
  return COMMANDS.map(
    (c) => `complete -c bertrand -n '__fish_use_subcommand' -a '${c}' -d '${c} command'`
  ).join("\n") + "\n";
}

export function generateCompletions() {
  const dir = join(paths.root, "completions");
  mkdirSync(dir, { recursive: true });

  writeFileSync(join(dir, "bertrand.bash"), bashCompletion());
  writeFileSync(join(dir, "_bertrand"), zshCompletion());
  writeFileSync(join(dir, "bertrand.fish"), fishCompletion());

  console.log(`Shell completions written to ${dir}`);
  console.log("  Add to your shell config:");
  console.log(`    bash: source ${dir}/bertrand.bash`);
  console.log(`    zsh:  fpath=(${dir} $fpath) && compinit`);
  console.log(`    fish: cp ${dir}/bertrand.fish ~/.config/fish/completions/`);
}
