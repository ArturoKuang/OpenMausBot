import { useEffect, useState } from "react";
import { api, useStore } from "@/state/store";
import { track } from "@/lib/analytics";
import { cornerPopupWaits, firstChatQuiet, firstReplyPending } from "@/lib/corner-popup";
import {
  ANNOUNCEMENT_NOTICE, BOAT_OFFER_NOTICE, CLOUD_INTRO, CLOUD_NOTICE, CLOUD_TRIAL_NOTICE, dismissNotices, GROK_MOVE_NOTICE,
  launchNotice, markLaunchNotice, MODELGO_OFFER_NOTICE, nextNotice, PHONE_UPDATE_NOTICE, phoneUpdateHint, PRODUCT_HUNT_NOTICE,
  SIMPLE_MODE_NOTICE, STAR_NOTICE, TEAMS_NOTICE, TWO_PLACES_NOTICE, UPDATES_CONSENT_NOTICE, WHATS_NEW_NOTICE,
} from "@/lib/notices";
import { useTwoPlaces } from "@/lib/two-places";
import { SIMPLE_ONLY } from "@/lib/simple-only";
import { useAdvancedBackDue, useNewLookDue } from "@/lib/new-look";
import { useAdvancedMode } from "@/lib/interface-mode";
import { useSimpleModePromptSeen } from "@/lib/simple-mode-prompt";
import { welcomeFinishedThisLaunch, type WelcomeViewer } from "@/lib/onboarding";
import { launchDialogShown, markLaunchDialog } from "@/lib/launch-dialogs";
import { useUpdaterState } from "@/lib/updater";
import { phonePairingSettingsAction } from "@/lib/phone-pairing";
import { useOtherDialogOpen } from "./notice-dialogs";
import { localDesktopPage } from "./onboarding/WelcomeGate";
import { useMausBotWelcomeDue } from "./MausBotWelcome";
import { NewLookNotice, reportNewLook } from "./NewLookNotice";
import { PhoneUpdateCard, phonesToTell, useRetiredLinkPhones } from "./PhoneUpdateNotice";
import { reportSimpleModePrompt, SimpleModePrompt } from "./SimpleModePrompt";
import { TwoPlacesCard } from "./TwoPlacesCard";

export function AppNotices({ quiet = false, viewer = null, now: _now = Date.now }: { quiet?: boolean; viewer?: WelcomeViewer | null; now?: () => number }) {
  const { state, dispatch } = useStore();
  const remote = window.ogb?.remoteClient?.active === true;
  const local = localDesktopPage();
  const [closed, setClosed] = useState(false);
  const [simpleShown, setSimpleShown] = useState(false);
  const updater = useUpdaterState();
  const mausBot = useMausBotWelcomeDue(viewer);
  const two = useTwoPlaces();
  const twoFact = !local || two.suggest === null ? false : two.suggest === undefined ? null : true;
  const linkPhones = useRetiredLinkPhones(!remote && local);
  const record = state.config?.onboarding;

  const promptSeen = useSimpleModePromptSeen(), newLookDue = useNewLookDue(), backDue = useAdvancedBackDue(), advanced = useAdvancedMode();
  const advancedBack = backDue && advanced;
  const simpleDue = SIMPLE_ONLY ? newLookDue : advancedBack || !promptSeen;
  const simpleBlocked = useOtherDialogOpen(simpleDue) || Boolean(state.liveCall && state.liveCall.status !== "ended");

  const waits = cornerPopupWaits(state, updater, { quiet, idle: true, viewer, duringFirstChat: true });
  const firstChat = firstReplyPending(state);
  const afterWelcome = welcomeFinishedThisLaunch() || launchDialogShown() === "mausbot" || firstChat;
  const mausBotFirst = mausBot.due;

  const retiredPhones = phonesToTell(linkPhones, record);
  const phoneNow = retiredPhones?.length === 0 ? false
    : retiredPhones === undefined || !viewer || mausBotFirst || (state.liveCall && state.liveCall.status !== "ended") ? null : true;
  const launch = launchNotice();

  const notice = waits || firstChatQuiet(state) ? null
    : simpleDue || twoFact !== false || phoneNow !== false ? nextNotice({
      [TEAMS_NOTICE]: false,
      [GROK_MOVE_NOTICE]: false,
      [PHONE_UPDATE_NOTICE]: phoneNow,
      [SIMPLE_MODE_NOTICE]: !simpleDue || afterWelcome === true ? false : afterWelcome === null || mausBotFirst || simpleBlocked ? null : true,
      [WHATS_NEW_NOTICE]: false,
      [UPDATES_CONSENT_NOTICE]: false,
      [TWO_PLACES_NOTICE]: twoFact,
      [PRODUCT_HUNT_NOTICE]: false,
      [CLOUD_INTRO]: false,
      [CLOUD_TRIAL_NOTICE]: false,
      [CLOUD_NOTICE]: false,
      [MODELGO_OFFER_NOTICE]: false,
      [BOAT_OFFER_NOTICE]: false,
      [ANNOUNCEMENT_NOTICE]: false,
      [STAR_NOTICE]: false,
    }, () => false, launch, closed) : null;

  useEffect(() => {
    if (!notice) return;
    markLaunchNotice(notice);
    if (notice === SIMPLE_MODE_NOTICE) markLaunchDialog("notices");
    if (notice === SIMPLE_MODE_NOTICE && !simpleShown) {
      setSimpleShown(true);
      if (SIMPLE_ONLY || advancedBack) reportNewLook("shown", advancedBack);
      else reportSimpleModePrompt("shown");
    }
  }, [notice]);

  const close = () => { setClosed(true); };
  if (!notice) return null;

  if (notice === PHONE_UPDATE_NOTICE && retiredPhones?.length) {
    const done = () => {
      close();
      const patch = dismissNotices(record, retiredPhones.map(phone => phoneUpdateHint(phone.id)));
      if (patch) void api("/api/config", { method: "PUT", body: JSON.stringify(patch) }).then(config => dispatch({ type: "configStatus", config })).catch(() => {});
    };
    return <PhoneUpdateCard phones={retiredPhones} onOpen={() => { done(); dispatch(phonePairingSettingsAction()); }} onDismiss={done} />;
  }

  if (notice === SIMPLE_MODE_NOTICE) {
    return SIMPLE_ONLY || advancedBack ? <NewLookNotice onClose={close} back={advancedBack} /> : <SimpleModePrompt onClose={close} />;
  }

  if (notice === TWO_PLACES_NOTICE && two.suggest) {
    const { key, kind } = two.suggest;
    return <TwoPlacesCard key={key} suggest={two.suggest}
      onBring={() => { track("two_places_card", { action: "bring", kind }); return two.accept(key).then(close); }}
      onDismiss={() => { track("two_places_card", { action: "not_now", kind }); two.dismiss(key); close(); }} />;
  }

  return null;
}
