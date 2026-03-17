export function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  function handleClick(e: React.MouseEvent) {
    e.stopPropagation()
    onChange(!checked)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault()
      e.stopPropagation()
      onChange(!checked)
    }
  }

  return (
    <div
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={`flex h-3.5 w-3.5 shrink-0 cursor-pointer items-center justify-center rounded-sm border ${
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-muted-foreground/40"
      }`}
    >
      {checked && (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path
            d="M2 5L4 7L8 3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  )
}
