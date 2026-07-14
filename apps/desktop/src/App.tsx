import { HashRouter, Route, Routes } from "react-router";
import { AppShell } from "@/components/AppShell";
import { AssetLibrary } from "@/screens/AssetLibrary";
import { DirectorChat } from "@/screens/DirectorChat";
import { Formats } from "@/screens/Formats";
import { ImageLab } from "@/screens/ImageLab";
import { JobCenter } from "@/screens/JobCenter";
import { MusicLab } from "@/screens/MusicLab";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { VideoLab } from "@/screens/VideoLab";
import { VoiceLab } from "@/screens/VoiceLab";

/* HashRouter: works identically under file:// when the Electron wrapper lands. */

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DirectorChat />} />
          <Route path="images" element={<ImageLab />} />
          <Route path="voice" element={<VoiceLab />} />
          <Route path="music" element={<MusicLab />} />
          <Route path="video" element={<VideoLab />} />
          <Route path="formats" element={<Formats />} />
          <Route path="assets" element={<AssetLibrary />} />
          <Route path="jobs" element={<JobCenter />} />
          <Route path="settings" element={<SettingsScreen />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
