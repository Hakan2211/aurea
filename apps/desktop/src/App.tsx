import { HashRouter, Route, Routes } from "react-router";
import {
  Clapperboard,
  FolderOpen,
  Mic,
  Music,
  Settings,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { DirectorChat } from "@/screens/DirectorChat";
import { Formats } from "@/screens/Formats";
import { ImageLab } from "@/screens/ImageLab";
import { JobCenter } from "@/screens/JobCenter";
import { Placeholder } from "@/screens/Placeholder";

/* HashRouter: works identically under file:// when the Electron wrapper lands. */

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DirectorChat />} />
          <Route path="images" element={<ImageLab />} />
          <Route
            path="voice"
            element={
              <Placeholder
                icon={Mic}
                title="Voice lab"
                blurb="TTS, voice cloning from a sample, and voice-to-voice conversion. Takes history with ratings; locked character voices feed productions."
                mockup="voice lab (TTS,cloning,voice-conversion).jpg"
              />
            }
          />
          <Route
            path="music"
            element={
              <Placeholder
                icon={Music}
                title="Music lab"
                blurb="ACE-Step songs and instrumentals with stem control — and cloned-voice vocals via voice conversion."
                mockup="Music lab.jpg"
              />
            }
          />
          <Route
            path="video"
            element={
              <Placeholder
                icon={Clapperboard}
                title="Video gen"
                blurb="LTX-2 locally for free, Seedance via API with a cost estimate up front. Keyframe-driven i2v, multiple takes, staged progress."
                mockup="videogen lab.jpg"
              />
            }
          />
          <Route path="formats" element={<Formats />} />
          <Route
            path="assets"
            element={
              <Placeholder
                icon={FolderOpen}
                title="Asset library"
                blurb="Everything you generate, searchable: images, takes, voices, music, 3D models — with metadata, tags, and send-to-timeline."
                mockup="asset library.jpg"
              />
            }
          />
          <Route path="jobs" element={<JobCenter />} />
          <Route
            path="settings"
            element={
              <Placeholder
                icon={Settings}
                title="Settings"
                blurb="AI providers (Claude via subscription, OpenRouter, Ollama), storage root, engines — and the ComfyUI escape hatch for power users."
                mockup="settings.jpg"
              />
            }
          />
        </Route>
      </Routes>
    </HashRouter>
  );
}
