import { useState } from "react";
import { Box, Text, TextInput } from "@orchetron/storm";

interface CreateProps {
  setError: (error: string | null) => void;
  handleCreateSubmit: (value: string) => void;
  error: string | null;
}

export function Create({ setError, handleCreateSubmit, error }: CreateProps) {
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
      />
      {error && <Text color="red">{error}</Text>}
    </Box>
  );
}
