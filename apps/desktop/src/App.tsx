import { HashRouter, Navigate, Route, Routes, useLocation, useParams } from "react-router";
import { AppShell } from "@/components/AppShell";
import { AreaLayout, lastTabKey } from "@/components/AreaLayout";
import { FirstRunWizard } from "@/components/FirstRunWizard";
import { AssetLibrary } from "@/screens/AssetLibrary";
import { BoardScreen } from "@/screens/Director";
import { Formats } from "@/screens/Formats";
import { HomeScreen } from "@/screens/Home";
import { ImageLab } from "@/screens/ImageLab";
import { JobCenter } from "@/screens/JobCenter";
import { MusicLab } from "@/screens/MusicLab";
import { SfxLab } from "@/screens/SfxLab";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { StudioScreen } from "@/screens/Studio";
import { DeskScreen } from "@/screens/desk/DeskScreen";
import { BibleScreen } from "@/screens/Bible";
import { VideoLab } from "@/screens/VideoLab";
import { Model3dLab } from "@/screens/Model3dLab";
import { TimelineScreen } from "@/screens/Timeline";
import { VoiceLab } from "@/screens/VoiceLab";
import { AREAS, LEGACY_ROUTES, type AreaKey } from "@/nav";

/* HashRouter: works identically under file:// inside Electron.
 *
 * Route map since the 2026-11 simplification (docs/UI-SIMPLIFY-PLAN.md):
 *   /                 Home
 *   /story/:tab       board · script · episodes(/:episodeId) · cast
 *   /create/:tab      image · video · voice · music · 3d
 *   /edit/:tab        timeline · formats
 *   /assets /jobs /settings   utilities
 * Every older route redirects (LEGACY_ROUTES), carrying router state along so
 * hand-offs like the board's "send to Video" prefill still arrive. */

/** a redirect that keeps location.state and the query string */
function Redirect({ to }: { to: string }) {
  const { state, search } = useLocation();
  return <Navigate to={`${to}${search}`} state={state} replace />;
}

function DeskEpisodeRedirect() {
  const { episodeId } = useParams();
  return <Redirect to={`/story/episodes/${episodeId ?? ""}`} />;
}

/** /create → the lab you were last in */
function AreaIndex({ area }: { area: AreaKey }) {
  const def = AREAS.find((a) => a.key === area)!;
  const last = localStorage.getItem(lastTabKey(area));
  const tab = def.tabs.find((t) => t.key === last) ?? def.tabs[0];
  return <Navigate to={`/${area}/${tab.key}`} replace />;
}

export function App() {
  return (
    <HashRouter>
      <FirstRunWizard />
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomeScreen />} />

          <Route path="story" element={<AreaLayout area="story" />}>
            <Route index element={<AreaIndex area="story" />} />
            <Route path="board" element={<BoardScreen />} />
            <Route path="script" element={<StudioScreen />} />
            <Route path="episodes" element={<DeskScreen />} />
            <Route path="episodes/:episodeId" element={<DeskScreen />} />
            <Route path="cast" element={<BibleScreen />} />
          </Route>

          <Route path="create" element={<AreaLayout area="create" />}>
            <Route index element={<AreaIndex area="create" />} />
            <Route path="image" element={<ImageLab />} />
            <Route path="video" element={<VideoLab />} />
            <Route path="voice" element={<VoiceLab />} />
            <Route path="music" element={<MusicLab />} />
            <Route path="sfx" element={<SfxLab />} />
            <Route path="3d" element={<Model3dLab />} />
          </Route>

          <Route path="edit" element={<AreaLayout area="edit" />}>
            <Route index element={<AreaIndex area="edit" />} />
            <Route path="timeline" element={<TimelineScreen />} />
            <Route path="formats" element={<Formats />} />
          </Route>

          <Route path="assets" element={<AssetLibrary />} />
          <Route path="jobs" element={<JobCenter />} />
          <Route path="settings" element={<SettingsScreen />} />

          {/* pre-2026-11 routes */}
          {Object.entries(LEGACY_ROUTES).map(([from, to]) => (
            <Route key={from} path={from} element={<Redirect to={to} />} />
          ))}
          <Route path="desk/:episodeId" element={<DeskEpisodeRedirect />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
