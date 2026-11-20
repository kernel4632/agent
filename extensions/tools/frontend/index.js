import ShellView from './ShellView.vue'
import FileView from './FileView.vue'

export default app => {
    app.toolViews.add('shell', ShellView)
    app.toolViews.add('read_file', FileView)
    app.toolViews.add('write_file', FileView)
    app.toolViews.add('edit_file', FileView)
    app.toolViews.add('list_dir', FileView)
    app.toolViews.add('webfetch', FileView)
}
