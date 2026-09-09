import { Box, Text } from "@orchetron/storm";

const greenGradient = [
  "#87d787", // ANSI 120
  "#87d787", // ANSI 114
  "#5faf5f", // ANSI 78
  "#5faf87", // ANSI 72
  "#00af00", // ANSI 34
  "#008700", // ANSI 28
  "#005f00", // ANSI 22
];

const logoLines = [
  ` .o8                              .                                        .o8 `,
  `"888                            .o8                                       "888 `,
  ` 888oooo.   .ooooo.  oooo d8b .o888oo oooo d8b  .oooo.   ooo. .oo.    .oooo888 `,
  ' d88\' `88b d88\' `88b `888""8P   888   `888""8P `P  )88b  `888P"Y88b  d88\' `888 ',
  ` 888   888 888ooo888  888       888    888      .oP"888   888   888  888   888 `,
  ` 888   888 888    .o  888       888 .  888     d8(  888   888   888  888   888 `,
  ' `Y8bod8P\' `Y8bod8P\' d888b      "888" d888b    `Y888""8o o888o o888o `Y8bod88P"',
];

export function Logo() {
  return (
    <Box flexDirection="column">
      {logoLines.map((line, i) => (
        <Text key={i} color={greenGradient[i]}>
          {line}
        </Text>
      ))}
    </Box>
  );
}
