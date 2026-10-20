// videoViewerSource -- the video twin of mk.it's imageViewerSource.
//
// The make app is the video player, but a share link is a full app page, so
// the JS-link form embeds the Make share link as the <video> src instead of
// the raw bytes: ln.kr accepts Make links as srcs, and Make links are
// deflated, so they take far less space than a base64 data URL.
export function videoViewerSource (source) {
	return `(function (src) {
    var v = document.createElement('video');
    v.src = src;
    v.controls = true;
    v.autoplay = true;
    v.playsInline = true;
    v.style = 'position:fixed;inset:0;width:100%;height:100%;background:#000;z-index:999999';
    document.body.appendChild(v);
})(${JSON.stringify(source)});`;
}
