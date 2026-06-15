import { useState } from "react";
import { useTui } from "@orchetron/storm";

import { ProjectPicker } from "@/tui/screens/project-picker/index";
import { Launch } from "@/tui/screens/launch/index";
import { createProject } from "@/lib/projects/create";
import { setActiveProjectSlug } from "@/lib/projects/registry";
import { _resetActiveProjectCache } from "@/lib/projects/resolve";

import type { ProjectPickerSelection } from "@/tui/screens/project-picker/project-picker.types";
import type { LaunchSelection } from "@/tui/screens/launch/launch.types";
import type { StartupProps, StartupSelection } from "./startup.types";

/**
 * Single Storm app that walks the pre-session flow: project picker →
 * launch. Doing both in one process avoids the alt-screen exit/re-enter
 * flash that subprocess-per-screen produced. Storm still unloads completely
 * before any Claude session starts (the subprocess exits after Launch
 * returns its selection), preserving the design goal in `app.tsx`.
 */
export function Startup({
  skipProjectPicker,
  initialProjectSlug,
  onSelect,
}: StartupProps) {
  const { exit } = useTui();
  const [activeSlug, setActiveSlug] = useState<string | null>(
    skipProjectPicker ? initialProjectSlug : null,
  );

  const finish = (s: StartupSelection) => {
    onSelect(s);
    exit();
  };

  const handleProjectSelect = (s: ProjectPickerSelection) => {
    switch (s.type) {
      case "quit":
        finish({ type: "quit" });
        return;
      case "create":
        createProject({ slug: s.slug });
        setActiveProjectSlug(s.slug);
        _resetActiveProjectCache();
        setActiveSlug(s.slug);
        return;
      case "select":
        setActiveProjectSlug(s.slug);
        _resetActiveProjectCache();
        setActiveSlug(s.slug);
        return;
    }
  };

  const handleLaunchSelect = (s: LaunchSelection) => {
    if (s.type === "quit" || activeSlug === null) {
      finish({ type: "quit" });
      return;
    }
    if (s.type === "create") {
      finish({
        type: "create",
        projectSlug: activeSlug,
        categoryPath: s.categoryPath,
        slug: s.slug,
      });
      return;
    }
    finish({ type: "pick", projectSlug: activeSlug, sessionId: s.sessionId });
  };

  if (activeSlug === null) {
    return <ProjectPicker onSelect={handleProjectSelect} />;
  }
  return <Launch onSelect={handleLaunchSelect} />;
}
