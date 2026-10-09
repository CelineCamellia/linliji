<script setup>
import { onLaunch } from '@dcloudio/uni-app';
import { ensureSession, isRelease } from './lib/api';
import { isTimelineScene } from './lib/share';
onLaunch((options) => {
  if (!isRelease && !isTimelineScene(options)) ensureSession().catch(() => {});
});
</script>
<style lang="scss">
@import './styles.scss';
</style>
