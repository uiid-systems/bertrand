import { Box, Text, TextInput } from "@orchetron/storm";

import { formatBindings } from "./launch.utils";

interface CreateProps {
  newName: string;
  setNewName: (newName: string) => void;
  setError: (error: string | null) => void;
  handleCreateSubmit: (value: string) => void;
  inputBindings: Array<{ label: string; description: string }>;
  error: string | null;
  escPending: boolean;
  clearEscPending: () => void;
}

export function Create({
  newName,
  setNewName,
  setError,
  handleCreateSubmit,
  inputBindings,
  error,
  escPending,
  clearEscPending,
}: CreateProps) {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="#82AAFF">
        New Session
      </Text>
      <Box height={1} />
      <Text>Name: </Text>
      <TextInput
        value={newName}
        onChange={(v: string) => {
          setNewName(v);
          setError(null);
          clearEscPending();
        }}
        onSubmit={handleCreateSubmit}
        placeholder="group/session-name"
      />
      {error && (
        <>
          <Box height={1} />
          <Text color="red">{error}</Text>
        </>
      )}
      <Box height={1} />
      {escPending ? (
        <Text color="yellow">Press esc again to cancel</Text>
      ) : (
        <Text dim>enter create · {formatBindings(inputBindings)}</Text>
      )}
    </Box>
  );
}
