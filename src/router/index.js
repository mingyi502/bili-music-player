import { createRouter, createWebHashHistory } from 'vue-router'
import PlaylistView from '../views/PlaylistView.vue'
import HistoryView from '../views/HistoryView.vue'
import SearchView from '../views/SearchView.vue'
import RankView from '../views/RankView.vue'
import SquareView from '../views/SquareView.vue'
import DailyView from '../views/DailyView.vue'
import FmView from '../views/FmView.vue'
import ArtistView from '../views/ArtistView.vue'
import AlbumView from '../views/AlbumView.vue'
import SongDetailView from '../views/SongDetailView.vue'
import StorageView from '../views/StorageView.vue'
import ReportView from '../views/ReportView.vue'

// hash 模式：Capacitor 打包后 base 为 './'，history 模式在 file:// 下不可用。
const routes = [
  { path: '/', name: 'playlist', component: PlaylistView },
  { path: '/daily', name: 'daily', component: DailyView },
  { path: '/fm', name: 'fm', component: FmView },
  { path: '/artist/:mid', name: 'artist', component: ArtistView },
  { path: '/album/:mid', name: 'album', component: AlbumView },
  { path: '/song/:id', name: 'song', component: SongDetailView },
  { path: '/search', name: 'search', component: SearchView },
  { path: '/rank', name: 'rank', component: RankView },
  { path: '/square', name: 'square', component: SquareView },
  { path: '/history', name: 'history', component: HistoryView },
  { path: '/storage', name: 'storage', component: StorageView },
  { path: '/report', name: 'report', component: ReportView },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router
