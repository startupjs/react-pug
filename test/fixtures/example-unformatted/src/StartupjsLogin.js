import React from 'react'
import { pug, styl } from './helpers'

function observer (fn) {
  return fn
}

const ScrollView = ({ children }) => <div>{children}</div>
const Content = ({ children }) => <div>{children}</div>
const Button = ({ children, onPress }) => <button onClick={onPress}>{children}</button>
const User = ({ name }) => <span>{name}</span>
const Card = ({ children }) => <section>{children}</section>
const Input = () => <input />
const Span = ({ children }) => <span>{children}</span>
const Tag = ({ children }) => <span>{children}</span>
const Alert = ({ children }) => <div>{children}</div>
const Br = () => <br />
const Item = ({ children, onPress }) => <button onClick={onPress}>{children}</button>
const Modal = ({ children }) => <div>{children}</div>
const Image = ({ source }) => <img alt='' src={source?.uri} />

const PROVIDERS = ['github']

export default observer(function Success () {
  const $user = {
    get: () => ({}),
    avatarFileId: { get: () => null },
    avatarUrl: { get: () => 'https://example.com/avatar.png' },
    name: { get: () => 'Alex' }
  }
  const $auth = {
    github: { scopes: { get: () => [] } }
  }
  const authProviderIds = []
  const loggedIn = false
  const $showForceLogin = { get: () => false, set: () => {} }
  const $showChangePhoto = { get: () => false, set: () => {} }

  const login = () => {}
  const logout = () => {}

  return pug`
    ScrollView(full): Content(padding gap full align='center' vAlign='center')
      if $user.get()
        Card.card(onPress=() => $showChangePhoto.set(true))
          if $user.avatarFileId.get()
            Photo(
              key=$user.avatarFileId.get()
              fileId=$user.avatarFileId.get()
              name=$user.name.get()
            )
          else
            User(
              avatarUrl=$user.avatarUrl.get()
              name=$user.name.get()
            )
        Modal($visible=$showChangePhoto)
          ChangePhoto($fileId=$user.avatarFileId)
      each provider in PROVIDERS
        - const loggedIn = authProviderIds.includes(provider)
        Button.button(
          key=provider
          disabled=loggedIn
          onPress=() => login(provider)
        )= (loggedIn ? 'Logged in' : 'Login') + ' with ' + provider.charAt(0).toUpperCase() + provider.slice(1)
        if loggedIn && provider === 'github'
          if $auth.github.scopes.get()?.includes('read:user')
            Tag(key=provider + '_tag' color='success') Access granted
          else
            Button.button(
              key=provider + '_grant'
              variant='text'
              onPress=() => login('github', { extraScopes: ['read:user'] })
            ) Grant access
      if !loggedIn
        Local
      if loggedIn
        Button.button(
          variant='text'
          color='error'
          onPress=logout
        ) Logout
        Input(type='checkbox' $value=$showForceLogin label='Show force login')
        if $showForceLogin.get()
          ForceLogin
  `
  styl`
    .card
      padding-top 1u
      padding-bottom 1u
    .button
      width 30u
  `
})

const Photo = observer(({ name }) => {
  return pug`
    User(part='root' name=name)
  `
})

const ChangePhoto = observer(({ $fileId }) => {
  return pug`
    if ($fileId.get())
      PhotoPreview($fileId=$fileId)
    Input(type='file' label='My photo' $value=$fileId image)
  `
})

const PhotoPreview = observer(() => {
  const url = 'https://example.com/photo.png'
  return pug`
    if url
      Image.preview(source={ uri: url })
  `
  styl`
    .preview
      width 200px
      height @width
  `
})

const ForceLogin = observer(() => {
  const $users = [{ getId: () => '1', name: { get: () => 'Alex' } }]
  const login = () => {}
  return pug`
    Card
      each $user in $users
        Item(
          key=$user.getId()
          onPress=() => login('force', { userId: $user.getId() })
        ) #{$user.name.get()}
  `
})

const Local = observer(() => {
  const $login = { get: () => ({}) }
  const $loginError = { get: () => '', set: () => {} }
  const $register = { get: () => ({}) }
  const $registerError = { get: () => '', set: () => {} }

  async function handleLogin () {
    try {
      return $login.get()
    } catch (err) {
      $loginError.set(err.message)
    }
  }

  async function handleRegister () {
    try {
      return { register: true, ...$register.get() }
    } catch (err) {
      $registerError.set(err.message)
    }
  }

  return pug`
    Card
      Span(h6) Login
      Br
      Input(
        type='object'
        properties=loginProperties
        $value=$login
      )
      if $loginError.get()
        Br
        Alert(variant='error')= $loginError.get()
      Br
      Button(onPress=handleLogin) Login
    Br
    Card
      Span(h6) Register
      Br
      Input(
        type='object'
        properties=registerProperties
        $value=$register
      )
      if $registerError.get()
        Br
        Alert(variant='error')= $registerError.get()
      Br
      Button(onPress=handleRegister) Register
  `
})

const loginProperties = {
  email: {
    type: 'string',
    label: 'Email',
    required: true
  }
}

const registerProperties = {
  email: {
    type: 'string',
    label: 'Email',
    required: true
  }
}
