import { Box, Text, TextInput } from "@orchetron/storm";

import { formatBindings } from "@/tui/screens/launch/launch.utils";

interface RenameProps {
  editValue: string;
  setEditValue: (value: string) => void;
  setError: (error: string | null) => void;
  handleRenameSubmit: (value: string) => void;
  inputBindings: Array<{ label: string; description: string }>;
  error: string | null;
  escPending: boolean;
  clearEscPending: () => void;
  placeholder: string;
}

export function Rename({
  editValue,
  setEditValue,
  setError,
  handleRenameSubmit,
  inputBindings,
  error,
  escPending,
  clearEscPending,
  placeholder,
}: RenameProps) {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="#82AAFF">
        Rename session
      </Text>
      <Box height={1} />
      <Text>New name: </Text>
      <TextInput
        value={editValue}
        onChange={(v: string) => {
          setEditValue(v);
          setError(null);
          clearEscPending();
        }}
        onSubmit={handleRenameSubmit}
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
        <Text dim>enter save · {formatBindings(inputBindings)}</Text>
      )}
    </Box>
  );
}
