import React from 'react'
import { pug, styl, observer, useSub, $ } from 'startupjs'
import { Div, Span, Avatar, Link } from 'startupjs-ui'

export default observer(({ $cat, showPhone, large, small }) => {
  const { name, number, phone, catgram, photoFileId, phonegram } = $cat.get()
  return (<Div part={'root'} row={true} vAlign={'center'}>{photoFileId ? <Photo className="avatar" styleName={{ large, small }} fileId={photoFileId} name={name} /> : <Avatar className="avatar" styleName={{ large, small }}>{name}</Avatar>}<Div row={true}><Span className="text" bold={true} styleName={{ large }}>{(number || 'X') + '. '}</Span><Div><Span className="text" styleName={{ large }}>{name}</Span>{showPhone ? <>{phone ? <Span className="text" styleName={{ large }}><Span bold={true}>Phone:{' '}</Span>{phone}</Span> : null}{catgram ? <Span className="text" styleName={{ large }}><Span bold={true}>Catgram:{' '}</Span><Link className="text" styleName={{ large }} to={getCatgramLink(catgram)}>{catgram}</Link></Span> : null}{phonegram ? <Span className="text" styleName={{ large }}><Span bold={true}>Phonegram:{' '}</Span><Link className="text" styleName={{ large }} to={getPhonegramLink(phonegram)}>{phonegram}</Link></Span> : null}</> : null}</Div></Div></Div>)
  /* eslint-disable-line */styl`
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
  return (<Avatar part={'root'} src={url}>{name}</Avatar>)
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
