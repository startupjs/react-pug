import { observer, useSub, $, styl } from "startupjs";
import { Div, Span, Avatar, Link } from "startupjs-ui";
var CatCard_default = observer(({ $cat, showPhone, large, small }) => {
  styl`
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

  `;
  const { name, number, phone, catgram, photoFileId, phonegram } = $cat.get();
  return <Div part='root' row vAlign='center'>{photoFileId ? <Photo styleName={["avatar", { large, small }]} fileId={photoFileId} name={name} /> : <Avatar styleName={["avatar", { large, small }]}>{name}</Avatar>}<Div row><Span styleName={["text", { large }]} bold>{(number || "X") + ". "}</Span><Div><Span styleName={["text", { large }]}>{name}</Span>{showPhone ? <>{phone ? <Span styleName={["text", { large }]}><Span bold>Phone:{" "}</Span>{phone}</Span> : null}{catgram ? <Span styleName={["text", { large }]}><Span bold>Catgram:{" "}</Span><Link styleName={["text", { large }]} to={getCatgramLink(catgram)}>{catgram}</Link></Span> : null}{phonegram ? <Span styleName={["text", { large }]}><Span bold>Phonegram:{" "}</Span><Link styleName={["text", { large }]} to={getPhonegramLink(phonegram)}>{phonegram}</Link></Span> : null}</> : null}</Div></Div></Div>;
});
const Photo = observer(({ fileId, name }) => {
  const $file = useSub($.files[fileId]);
  let url;
  try {
    url = $file.getUrl();
  } catch (err) {
  }
  return <Avatar part='root' src={url}>{name}</Avatar>;
});
function getCatgramLink(username) {
  if (!username) return;
  if (/:\/\//.test(username)) return username;
  return "https://catgr.am/" + username;
}
function getPhonegramLink(username) {
  if (!username) return;
  if (/:\/\//.test(username)) return username;
  return "https://www.phonegram.com/" + username;
}
export {
  CatCard_default as default
};
