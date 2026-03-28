import { Stack } from "@uiid/design-system";

type SegmentWrapperProps = {
  children: React.ReactNode;
  className?: string;
};

export const SegmentWrapper = ({
  children,
  className,
}: SegmentWrapperProps) => {
  return (
    <Stack gap={2} my={1} py={2} pl={2} bl={2} maxw={640} className={className}>
      {children}
    </Stack>
  );
};
SegmentWrapper.displayName = "SegmentWrapper";
