import React from "react";
import { observer, $, useSub, styl } from "startupjs";
import { Alert, Span, Modal, Content, Button, Form, Div, Tag, useMedia, useFormFields } from "startupjs-ui";
import { useGlobalSearchParams, Stack } from "expo-router";
import { faPen } from "@fortawesome/free-solid-svg-icons/faPen";
import CatCard from "@/components/CatCard";
import * as stages from "@/components/stages";
import { CAT_PROFILE_EDIT_FORM } from "@/model/cats/schema";
import { STAGES } from "@/model/events/schema";
var cat_profile_link_default = observer(() => {
  const { token } = useGlobalSearchParams();
  const [$cat] = useSub($.cats, { token });
  if (!$cat) return renderExpired();
  const eventId = $cat.eventId.get();
  const $event = useSub($.events[eventId]);
  function renderTitle() {
    return <CatCard $cat={$cat} />;
  }
  function renderSettings() {
    return <Profile $cat={$cat} $event={$event} />;
  }
  const Stage = stages[$cat.getMyStage()];
  return <><Stack.Screen options={{
    headerTitle: renderTitle,
    headerRight: renderSettings
  }} /><Stage $cat={$cat} $event={$event} /></>;
});
const Profile = observer(({ $cat, $event }) => {
  styl`
    .hackSidePadding
      width 1u

  `;
  const $showEdit = $();
  const { tablet } = useMedia();
  const excludeNumber = $event.stage.get() !== STAGES.InProgress;
  const profileEditFields = useFormFields(CAT_PROFILE_EDIT_FORM, excludeNumber ? { exclude: ["number"] } : {});
  return <><Div row vAlign='center' gap={1}>{!hasContact($cat) ? <Tag color='error'>No contact</Tag> : null}{!$cat.photoFileId.get() ? <Tag color='error'>No photo</Tag> : null}{$cat.getMyStage() === STAGES.Profile ? <Div styleName={["hackSidePadding"]} /> : <Button variant='text' icon={faPen} onPress={() => $showEdit.set(true)}>{tablet ? "Edit cat profile" : "Edit"}</Button>}</Div><Modal title='Edit cat profile' $visible={$showEdit}><Form fields={profileEditFields} $value={$cat} /></Modal></>;
});
function hasContact($cat) {
  return ($cat.phone.get() || "").trim() || ($cat.catgram.get() || "").trim() || ($cat.phonegram.get() || "").trim();
}
function renderExpired() {
  return <Content padding><Alert variant='error'><Span>Cat profile link is incorrect or already expired.

Your cat meetup profile link is only valid for a limited period of time.

If you believe this is an error, please contact the cat meetup organizer.</Span></Alert></Content>;
}
export {
  cat_profile_link_default as default
};
