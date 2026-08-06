import { HashRouter, Navigate, Route, Routes } from "react-router";
import { AppShell } from "@/components/AppShell";
import { FirstRunWizard } from "@/components/FirstRunWizard";
import { AssetLibrary } from "@/screens/AssetLibrary";
import { DirectorScreen } from "@/screens/Director";
import { Formats } from "@/screens/Formats";
import { ImageLab } from "@/screens/ImageLab";
import { JobCenter } from "@/screens/JobCenter";
import { MusicLab } from "@/screens/MusicLab";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { StudioScreen } from "@/screens/Studio";
import { BibleScreen } from "@/screens/Bible";
import { VideoLab } from "@/screens/VideoLab";
import { TimelineScreen } from "@/screens/Timeline";
import { VoiceLab } from "@/screens/VoiceLab";

/* HashRouter: works identically under file:// when the Electron wrapper lands. */

export function App() {
  return (
    <HashRouter>
      <FirstRunWizard />
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DirectorScreen />} />
          <Route path="studio" element={<StudioScreen />} />
          {/* the 2026-08-06 route merges: the storyboard lives inside the
              Director, the screenplay is the Studio's Script view */}
          <Route path="storyboard" element={<Navigate to="/" replace />} />
          <Route path="script" element={<Navigate to="/studio" replace />} />
          <Route path="bible" element={<BibleScreen />} />
          <Route path="images" element={<ImageLab />} />
          <Route path="voice" element={<VoiceLab />} />
          <Route path="music" element={<MusicLab />} />
          <Route path="video" element={<VideoLab />} />
          <Route path="timeline" element={<TimelineScreen />} />
          <Route path="formats" element={<Formats />} />
          <Route path="assets" element={<AssetLibrary />} />
          <Route path="jobs" element={<JobCenter />} />
          <Route path="settings" element={<SettingsScreen />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
