import { useState } from "react";
import { Box, Text, TextInput } from "@orchetron/storm";

interface CreateProps {
  isFocused: boolean;
  setError: (error: string | null) => void;
  handleCreateSubmit: (value: string) => void;
  error: string | null;
}

export function Create({ isFocused, setError, handleCreateSubmit, error }: CreateProps) {
  const [newName, setNewName] = useState("");

  const handleChange = (v: string) => {
    setNewName(v);
    setError(null);
  };

  return (
    <Box flexDirection="column">
      <Text>Create a session:</Text>
      <TextInput
        value={newName}
        onChange={handleChange}
        onSubmit={handleCreateSubmit}
        placeholder="group/session-name"
        placeholderColor="green"
        color="green"
        isFocused={isFocused}
      />
      {error && <Text color="red">{error}</Text>}
    </Box>
  );
}
