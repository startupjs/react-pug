import React from 'react'
import { pug, styl } from './helpers'

function observer (fn) {
  return fn
}

const View = ({ children }) => <div>{children}</div>
const Text = ({ children }) => <span>{children}</span>
const Link = ({ children }) => <a>{children}</a>
const Button = ({ children, onPress }) => <button onClick={onPress}>{children}</button>
const Br = () => <br />
const Card = ({ children }) => <section>{children}</section>
const User = ({ name }) => <span>{name}</span>

export default observer(function TabThreeScreen () {
  const $user = { get: () => ({}) }
  const address1 = { city: { street: { building: 42, isFlat: true } } }
  const address2 = {}

  const renderDummy = () => {
    return <Text>dummy jsx</Text>
  }

  function handleTestWorkerJob () {
    return address1?.city?.street?.building
  }

  function handleTestWorkerJobWithError () {
    return address2?.city?.street?.building
  }

  return pug`
    View.container
      = renderDummy()
      Text.title Tab Three
      View
        Text= address2.something ?? 'nullish coalescing'
        Text= address1?.city?.street?.building
        if address1?.city?.street?.isFlat
          Text address 1 is flat
        else
          Text address 1 is NOT flat
        if address2?.city?.street?.isFlat
          Text address 2 is flat
        else
          Text address 2 is NOT flat
      View.box
      Br
      if $user.get()
        Card.card
          User(name='Alex')
      Br
      Link(to='/auth/login')
        Button Login
      Br
      Button(onPress=handleTestWorkerJob) Run Worker Job
      Button(onPress=handleTestWorkerJobWithError) Run Worker Job With Error
  `
  styl`
    .card
      padding-top 1u
      padding-bottom 1u
  `
})

styl`
  .container
    flex 1
    align-items center
    justify-content center
  .title
    font-size 20px
    font-weight bold
  .separator
    margin 30px 0
    height 1px
    width 80%
  .box
    width 4u
    height @width
    background-color red
    +tablet()
      background-color green
`
