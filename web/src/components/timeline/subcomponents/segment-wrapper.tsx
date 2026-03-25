import { Stack } from "@uiid/layout";

export const SegmentWrapper = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <Stack gap={2} my={1} py={2} pl={2} bl={2} maxw={640} className={className}>
      {children}
    </Stack>
  );
};
