import { router } from 'expo-router'
import { observer, pug } from 'startupjs'
import { Button, Content, Div, ScrollView, Span } from 'startupjs-ui'

export default observer(function ModalScreen () {
  return pug`
    ScrollView(full)
      Content.modalContent(padding)
        Div.modalCard
          Span.modalEyebrow Board Notes
          Span.modalTitle(h2) Card details land here next
          Span.modalCopy Task 1 keeps this route lightweight so the board shell and E2E harness are stable first.
          Span.modalCopy Task 4 will turn this into the richer card editor for descriptions, labels, dates, and checklist work.
          Button(
            accessibilityLabel='Close board notes'
            onPress=() => router.back()
            variant='outlined'
          ) Back to board
    style(lang='styl')
      .modalContent
        min-height 100%
        justify-content center
        background-color #ebe3d4
      .modalCard
        padding 3u
        border-radius 4u
        background-color #f7f2e8
        border 1px solid rgba(49, 78, 64, 0.12)
        box-shadow 0 12px 28px rgba(35, 49, 41, 0.12)
        gap 1.5u
      .modalEyebrow
        text-transform uppercase
        letter-spacing 0.2u
        font-size 1.5u
        font-weight 700
        color #5a6b60
      .modalTitle
        color #1f2b23
      .modalCopy
        color #53655a
        line-height 2.75u
  `
})
