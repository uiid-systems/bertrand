/** Parse a session name into { project, ticket, session } */
export function parseSessionName(name: string): {
  project: string
  ticket: string
  session: string
} {
  const parts = name.split("/")
  if (parts.length === 3) {
    return { project: parts[0]!, ticket: parts[1]!, session: parts[2]! }
  }
  // Names without a ticket component (e.g. "bertrand/fix-navbar") land in direct group
  return { project: parts[0]!, ticket: "", session: parts.slice(1).join("/") }
}
