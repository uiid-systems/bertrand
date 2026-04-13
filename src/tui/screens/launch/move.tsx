import { Box, Text, TextInput } from "@orchetron/storm";

import { formatBindings } from "./launch.utils";

interface MoveProps {
  editValue: string;
  setEditValue: (editValue: string) => void;
  setError: (error: string | null) => void;
  handleMoveSubmit: (value: string) => void;
  inputBindings: Array<{ label: string; description: string }>;
  error: string | null;
  escPending: boolean;
  clearEscPending: () => void;
  placeholder?: string;
}

export function Move({
  editValue,
  setEditValue,
  setError,
  handleMoveSubmit,
  inputBindings,
  error,
  escPending,
  clearEscPending,
  placeholder = "category/session-name",
}: MoveProps) {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="#82AAFF">
        Move session
      </Text>
      <Box height={1} />
      <Text>New group path: </Text>
      <TextInput
        value={editValue}
        onChange={(v: string) => {
          setEditValue(v);
          setError(null);
          clearEscPending();
        }}
        onSubmit={handleMoveSubmit}
        placeholder={placeholder}
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
        <Text dim>enter move · {formatBindings(inputBindings)}</Text>
      )}
    </Box>
  );
}
