import { pug } from 'startupjs'

const Button = 'Button'
const Span = 'Span'
const MAX_ITEMS = 10

export function TypeCell ({ possibleValues, toggleList, collapsed, type }) {
  const values = possibleValues || []

  function renderButton () {
    if (possibleValues?.length <= MAX_ITEMS) return null
    return pug`
      Span &nbsp&nbsp
      Button(onPress=toggleList)= collapsed ? 'More...' : 'Less'
    `
  }

  return pug`
    if type === 'oneOf'
      Span
        each value, index in values
          Span(key=index)= value
        = renderButton()
    else
      Span= type
  `
}
