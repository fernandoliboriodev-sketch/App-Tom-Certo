import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Image } from 'react-native';

const C = { bg: '#0A0A0A', amber: '#FFB020', text: '#A1A1AA' };

export default function AuthLoadingScreen() {
  return (
    <View style={styles.wrap}>
      <Image
        source={require('../../assets/images/app-logo.png')}
        style={styles.logo}
        resizeMode="contain"
      />
      <ActivityIndicator size="small" color={C.amber} style={{ marginTop: 22 }} />
      <Text style={styles.txt}>Verificando acesso...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: { width: 80, height: 80 },
  txt: {
    color: C.text,
    marginTop: 14,
    fontSize: 13,
    letterSpacing: 0.5,
  },
});
