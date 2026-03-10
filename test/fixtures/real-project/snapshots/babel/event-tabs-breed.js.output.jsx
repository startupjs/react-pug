import React, { useState } from 'react';
import { observer, useSub, $, styl } from 'startupjs';
import { Link, Item, ScrollView, Form, useFormProps, Alert, Content, Tag, Br, Button, Modal, Div, confirm, useFormFields$, useValidate } from 'startupjs-ui';
import { useGlobalSearchParams } from 'expo-router';
import { faPen } from '@fortawesome/free-solid-svg-icons/faPen';
import { faHeart } from '@fortawesome/free-solid-svg-icons/faHeart';
import { faLink } from '@fortawesome/free-solid-svg-icons/faLink';
import CatCard from '@/components/CatCard';
import { CAT_FORM } from '@/model/cats/schema';
export default observer(({
  breed
}) => {
  const {
    eventId
  } = useGlobalSearchParams();
  const [$selected, set$selected] = useState();
  const $new = $();
  const $showModal = $();
  const $mode = $();
  const $fields = useFormFields$(CAT_FORM);
  const validate = useValidate();
  function showCreate() {
    $new.set({
      breed
    });
    $fields.breed.disabled.set(true);
    set$selected(() => $new);
    $mode.set('new');
    $showModal.set(true);
  }
  function showEdit($cat) {
    $fields.breed.disabled.del();
    set$selected(() => $cat);
    $mode.set('edit');
    $showModal.set(true);
  }
  function cancel() {
    if (!$showModal.get()) return;
    $showModal.del();
    $mode.del();
  }
  async function create() {
    if (!validate()) return;
    await $.cats.addNew({
      ...$new.getDeepCopy(),
      eventId
    });
    cancel();
  }
  async function deleteCat() {
    if (!(await confirm(`Are you sure you want to delete ${$selected.name.get()}?`))) return;
    await $selected.del();
    cancel();
  }
  return <><ScrollView full><Content full pure><CatsList eventId={eventId} onEdit={showEdit} breed={breed} /></Content></ScrollView><Content padding={1}><Button onPress={showCreate}>Add new {breed}</Button></Content><Modal title={$mode.get() === 'new' ? 'Create cat' : 'Edit cat'} $visible={$showModal} onDismiss={cancel}>{(() => {
        const oppositeBreed = $selected?.breed.get() && ($selected.breed.get() === 'domestic' ? 'wild' : 'domestic');
        return <><Form key={$selected?.getId() || 'NEW'} $fields={$fields} $value={$selected} oppositeBreed={oppositeBreed} eventId={eventId} customInputs={{
            likes: SelectLikesInput
          }} validate={validate} /><Br />{$mode.get() === 'new' ? <Div align={'right'} row><Button onPress={cancel}>Cancel</Button><Button disabled={validate.hasErrors} pushed variant={'flat'} color={'primary'} onPress={create}>Create</Button></Div> : $mode.get() === 'edit' ? <Div align={'right'} row><Button color={'error'} onPress={deleteCat}>Delete</Button></Div> : null}</>;
      })()}</Modal></>;
});
const CatsList = observer(({
  onEdit,
  breed,
  eventId
}) => {
  if (!eventId) return <Alert variant={'error'}>No event specified</Alert>;
  const $cats = useSub($.cats, {
    eventId,
    breed,
    $sort: {
      breed: 1,
      number: 1
    }
  });
  return (() => {
    const __pugEachResult = [];
    for (const $cat of $cats) {
      __pugEachResult.push(<Item key={$cat.getId()}><CatCard $cat={$cat} /><Item.Right><Div vAlign={'center'} row gap={1}>{!hasContact($cat) ? <Tag color={'error'}>No contact</Tag> : null}{!$cat.photoFileId.get() ? <Tag color={'error'}>No photo</Tag> : null}<Button variant={'text'} icon={faPen} onPress={() => onEdit($cat)} tooltip={'Edit'} /><Link href={'/events/' + eventId + '/matches/' + $cat.getId()}><Button variant={'text'} icon={faHeart} tooltip={'Matches'} /></Link><Link href={'/cats/' + $cat.token.get()}><Button variant={'text'} icon={faLink} tooltip={'Cat profile link'}>Link</Button></Link></Div></Item.Right></Item>);
    }
    return __pugEachResult;
  })();
});
function hasContact($cat) {
  return ($cat.phone.get() || '').trim() || ($cat.catgram.get() || '').trim() || ($cat.phonegram.get() || '').trim();
}
const SelectLikesInput = observer(({
  $value,
  ...props
}) => {
  const {
    oppositeBreed,
    eventId
  } = {
    ...useFormProps(),
    ...props
  };
  return oppositeBreed ? <SelectLikes $likes={$value} oppositeBreed={oppositeBreed} eventId={eventId} /> : <Alert variant={'warning'}>Select breed to choose likes</Alert>;
});
const SelectLikes = observer(({
  $likes,
  oppositeBreed,
  eventId
}) => {
  styl`
    .item
      border-radius 1u
      &.selected
        // FIXME: We can't use color var(--color-text-success-strong) here
        background-color var(--color-text-success-strong)

  `;
  const $cats = useSub($.cats, {
    eventId,
    breed: oppositeBreed,
    $sort: {
      breed: 1,
      number: 1
    }
  });
  return (() => {
    const __pugEachResult = [];
    for (const $cat of $cats) {
      __pugEachResult.push((() => {
        const catId = $cat.getId();
        return <Item styleName={["item", {
          selected: $likes[catId].get()
        }]} key={catId} onPress={() => $likes[catId].get() ? $likes[catId].del() : $likes[catId].set(true)}><CatCard $cat={$cat} small /></Item>;
      })());
    }
    return __pugEachResult.length ? __pugEachResult : <Alert variant={'info'}>No cats with selected breed yet</Alert>;
  })();
});