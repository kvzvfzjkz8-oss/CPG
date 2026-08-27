import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, Pressable, FlatList, KeyboardAvoidingView, Platform, StyleSheet,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, fonts, radius } from '../theme';
import { ScreenHeader } from '../components/UI';
import { initialMessages } from '../data/mockData';

export default function ChatScreen() {
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState('');
  const listRef = useRef(null);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    const mine = { id: `m${Date.now()}`, from: 'me', text };
    setMessages((prev) => [...prev, mine]);
    setDraft('');

    // TODO: remplacer par un envoi réel (WebSocket ou API de messagerie CPG)
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: `m${Date.now()}r`,
          from: 'advisor',
          text: 'Merci, je regarde votre demande et je reviens vers vous rapidement.',
        },
      ]);
    }, 1000);
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <ScreenHeader title="Messagerie" subtitle="Conseillère · Sylvie M." />

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12, gap: 8 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => {
          const mine = item.from === 'me';
          return (
            <View style={[styles.bubbleWrap, { alignSelf: mine ? 'flex-end' : 'flex-start' }]}>
              <View
                style={[
                  styles.bubble,
                  mine ? styles.bubbleMine : styles.bubbleTheirs,
                ]}
              >
                <Text style={[styles.bubbleText, { color: mine ? '#fff' : colors.ink }]}>
                  {item.text}
                </Text>
              </View>
            </View>
          );
        }}
      />

      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={send}
          placeholder="Écrire un message…"
          placeholderTextColor={colors.muted}
          returnKeyType="send"
          style={styles.input}
        />
        <Pressable
          onPress={send}
          accessibilityRole="button"
          accessibilityLabel="Envoyer le message"
          style={styles.sendBtn}
        >
          <Feather name="send" size={15} color="#fff" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  bubbleWrap: { maxWidth: '78%' },
  bubble: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: radius.lg },
  bubbleMine: { backgroundColor: colors.forest, borderBottomRightRadius: 4 },
  bubbleTheirs: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderBottomLeftRadius: 4,
  },
  bubbleText: { fontSize: 13, fontFamily: fonts.body, lineHeight: 18 },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.bg,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 13,
    color: colors.ink,
    fontFamily: fonts.body,
    backgroundColor: colors.card,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.forest,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
