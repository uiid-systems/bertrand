import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type SecondarySidebarContextValue = {
  content: ReactNode;
  setContent: (content: ReactNode) => void;
};

const SecondarySidebarContext = createContext<SecondarySidebarContextValue>({
  content: null,
  setContent: () => {},
});

export const SecondarySidebarProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [content, setContent] = useState<ReactNode>(null);

  return (
    <SecondarySidebarContext.Provider value={{ content, setContent }}>
      {children}
    </SecondarySidebarContext.Provider>
  );
};

export const useSecondarySidebar = (content: ReactNode) => {
  const { setContent } = useContext(SecondarySidebarContext);

  useEffect(() => {
    setContent(content);
    return () => setContent(null);
  });
};

export const useSecondarySidebarContent = () =>
  useContext(SecondarySidebarContext).content;
