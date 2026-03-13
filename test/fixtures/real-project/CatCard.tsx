import React from 'react'
import { pug, observer, useSub, $ } from 'startupjs'
import { Div, Span, Avatar, Link } from 'startupjs-ui'

export default observer(({ $cat, showPhone, large, small }) => {
  const { name, number, phone, catgram, photoFileId, phonegram } = $cat.get()
  return pug`
    Div(part='root' row vAlign='center')
      if photoFileId
        Photo.avatar(styleName={ large, small } fileId=photoFileId name=name)
      else
        Avatar.avatar(styleName={ large, small })= name
      Div(row)
        Span.text(bold styleName={ large })= (number || 'X') + '. '
        Div
          Span.text(styleName={ large })= name
          if showPhone
            if phone
              Span.text(styleName={ large })
                Span(bold) Phone:#{' '}
                = phone
            if catgram
              Span.text(styleName={ large })
                Span(bold) Catgram:#{' '}
                Link.text(styleName={ large } to=getCatgramLink(catgram))= catgram
            if phonegram
              Span.text(styleName={ large })
                Span(bold) Phonegram:#{' '}
                Link.text(styleName={ large } to=getPhonegramLink(phonegram))= phonegram
    style(lang='styl')
      .avatar
        margin-right 1u
        &.large
          width 12u
          height @width
        &.small
          width 4u
          height @width
      .text.large
        font(h6)
  `
})

const Photo = observer(({ fileId, name }) => {
  const $file = useSub($.files[fileId])
  let url
  try { url = $file.getUrl() } catch (err) {}
  return pug`
    Avatar(part='root' src=url)= name
  `
})

function getCatgramLink (username) {
  if (!username) return
  if (/:\/\//.test(username)) return username
  return 'https://catgr.am/' + username
}

function getPhonegramLink (username) {
  if (!username) return
  if (/:\/\//.test(username)) return username
  return 'https://www.phonegram.com/' + username
}
