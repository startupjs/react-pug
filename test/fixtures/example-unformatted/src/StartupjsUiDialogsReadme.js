import { Fragment } from 'react'
import { pug } from 'startupjs'

const Button = 'Button'
const Br = 'Br'

export function DialogsProviderSandbox ({ onPressAlert, onPressConfirm, onPressPrompt }) {
  return pug`
    Fragment
      Button(onPress=onPressAlert) Show alert
      Br
      Button(onPress=onPressConfirm) Show confirm
      Br
      Button(onPress=onPressPrompt) Show prompt
  `
}
