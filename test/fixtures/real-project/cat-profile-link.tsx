import React from 'react'
import { pug, observer, $, useSub } from 'startupjs'
import { Alert, Span, Modal, Content, Button, Form, Div, Tag, useMedia, useFormFields } from 'startupjs-ui'
import { useGlobalSearchParams, Stack } from 'expo-router'
import { faPen } from '@fortawesome/free-solid-svg-icons/faPen'
import CatCard from '@/components/CatCard'
import * as stages from '@/components/stages'
import { CAT_PROFILE_EDIT_FORM } from '@/model/cats/schema'
import { STAGES } from '@/model/events/schema'

export default observer(() => {
  const { token } = useGlobalSearchParams()
  const [$cat] = useSub($.cats, { token })
  if (!$cat) return renderExpired()

  const eventId = $cat.eventId.get()
  const $event = useSub($.events[eventId])

  function renderTitle () {
    return pug`
      CatCard($cat=$cat)
    `
  }

  function renderSettings () {
    return pug`
      Profile($cat=$cat $event=$event)
    `
  }

  const Stage = stages[$cat.getMyStage()]

  return pug`
    Stack.Screen(
      options={
        headerTitle: renderTitle,
        headerRight: renderSettings
      }
    )
    Stage($cat=$cat $event=$event)
  `
})

const Profile = observer(({ $cat, $event }) => {
  const $showEdit = $()
  const { tablet } = useMedia()
  const excludeNumber = $event.stage.get() !== STAGES.InProgress
  const profileEditFields = useFormFields(CAT_PROFILE_EDIT_FORM, excludeNumber ? { exclude: ['number'] } : {})

  return pug`
    Div(row vAlign='center' gap=1)
      if !hasContact($cat)
        Tag(color='error') No contact
      if !$cat.photoFileId.get()
        Tag(color='error') No photo
      if $cat.getMyStage() === STAGES.Profile
        Div.hackSidePadding
      else
        Button(
          variant='text'
          icon=faPen
          onPress=() => $showEdit.set(true)
        )
          if tablet
            = 'Edit cat profile'
          else
            = 'Edit'
    Modal(
      title='Edit cat profile'
      $visible=$showEdit
    )
      Form(
        fields=profileEditFields
        $value=$cat
      )
    style(lang='styl')
      .hackSidePadding
        width 1u
  `
})

function hasContact ($cat) {
  return ($cat.phone.get() || '').trim() || ($cat.catgram.get() || '').trim() || ($cat.phonegram.get() || '').trim()
}

function renderExpired () {
  return pug`
    Content(padding)
      Alert(variant='error')
        Span
          | Cat profile link is incorrect or already expired.
          |
          | Your cat meetup profile link is only valid for a limited period of time.
          |
          | If you believe this is an error, please contact the cat meetup organizer.
  `
}
