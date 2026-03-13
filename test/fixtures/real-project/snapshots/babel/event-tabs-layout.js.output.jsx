import React from 'react';
import { observer, $, useSub, styl } from 'startupjs';
import { useColors, Icon, Form, Modal, Button } from 'startupjs-ui';
import { Tabs, useLocalSearchParams, Stack } from 'expo-router';
import { faVenus as faWildBadge } from '@fortawesome/free-solid-svg-icons/faVenus';
import { faMars as faDomesticBadge } from '@fortawesome/free-solid-svg-icons/faMars';
import { faHeart } from '@fortawesome/free-solid-svg-icons/faHeart';
import { faPen } from '@fortawesome/free-solid-svg-icons/faPen';
import { faToolbox } from '@fortawesome/free-solid-svg-icons/faToolbox';
import { EVENT_FORM } from '@/model/events/schema';
export default observer(function TabLayout() {
  styl`
    +tablet()
      .screen
        &:part(tabBar)
          order -1
          background-color transparent
          border-bottom-width 1px
          border-bottom-color rgba(0, 0, 0, 0.1)

  `;
  const getColor = useColors();
  const {
    eventId
  } = useLocalSearchParams();
  const $event = useSub($.events[eventId]);
  if (!$event.get()) throw Error('No such event');
  return <><Stack.Screen options={{
      title: $event.name.get(),
      headerRight: () => renderEditEvent({
        $event
      })
    }} /><Tabs title={$event.name.get()} screenOptions={{
      ...styl('screen'),
      tabBarActiveTintColor: getColor('primary'),
      tabBarActiveBackgroundColor: 'rgba(255, 255, 255, 0.5)',
      headerShown: false,
      headerTitle: $event.name.get()
    }}><Tabs.Screen name='index' options={{
        title: 'Dashboard',
        tabBarIcon: renderHomeIcon
      }} /><Tabs.Screen name='-breed' options={{
        href: null
      }} /><Tabs.Screen name='domestic' options={{
        title: 'Domestic Cats',
        tabBarIcon: renderDomesticIcon
      }} /><Tabs.Screen name='wild' options={{
        title: 'Wild Cats',
        tabBarIcon: renderWildIcon
      }} /><Tabs.Screen name='test' options={{
        title: 'Dev Only',
        tabBarIcon: renderTestIcon
      }} /></Tabs></>;
});
function renderEditEvent({
  $event
}) {
  return <EditEvent $event={$event} />;
}
const EditEvent = observer(({
  $event
}) => {
  const $showModal = $();
  return <><Button onPress={() => $showModal.set(true)} variant='text' icon={faPen}>Edit this cat meetup</Button><Modal title='Edit cat meetup' $visible={$showModal}><Form $value={$event} fields={EVENT_FORM} /></Modal></>;
});
function renderWildIcon({
  color,
  size
}) {
  return <Icon icon={faWildBadge} style={{
    color,
    width: size,
    height: size
  }} />;
}
function renderDomesticIcon({
  color,
  size
}) {
  return <Icon icon={faDomesticBadge} style={{
    color,
    width: size,
    height: size
  }} />;
}
function renderHomeIcon({
  color,
  size
}) {
  return <Icon icon={faHeart} style={{
    color,
    width: size,
    height: size
  }} />;
}
function renderTestIcon({
  color,
  size
}) {
  return <Icon icon={faToolbox} style={{
    color,
    width: size,
    height: size
  }} />;
}