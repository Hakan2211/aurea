import { HashRouter, Route, Routes } from "react-router";
import { AppShell } from "@/components/AppShell";
import { FirstRunWizard } from "@/components/FirstRunWizard";
import { AssetLibrary } from "@/screens/AssetLibrary";
import { DirectorChat } from "@/screens/DirectorChat";
import { Formats } from "@/screens/Formats";
import { ImageLab } from "@/screens/ImageLab";
import { JobCenter } from "@/screens/JobCenter";
import { MusicLab } from "@/screens/MusicLab";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { StudioScreen } from "@/screens/Studio";
import { StoryboardScreen } from "@/screens/Storyboard";
import { WritersRoomScreen } from "@/screens/WritersRoom";
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
          <Route index element={<DirectorChat />} />
          <Route path="studio" element={<StudioScreen />} />
          <Route path="script" element={<WritersRoomScreen />} />
          <Route path="storyboard" element={<StoryboardScreen />} />
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
