import { StyleSheet } from 'react-native';

import { TeamMap } from '@/components/map/team-map';
import { ThemedView } from '@/components/themed-view';

export default function SitesScreen() {
  return (
    <ThemedView style={styles.container}>
      <TeamMap />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
