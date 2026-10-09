package com.linliji.app;

import android.app.Activity;
import android.os.Bundle;
import android.os.Build;
import android.graphics.Color;
import android.content.Intent;
import android.net.Uri;
import android.view.WindowInsets;
import android.webkit.WebView;
import android.webkit.ValueCallback;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.widget.FrameLayout;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

public final class MainActivity extends Activity {
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private static final int PICK_PHOTO = 401;
    private static final String APP_HOST = "appassets.androidplatform.net";

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(246,247,243));
        getWindow().setNavigationBarColor(Color.WHITE);
        FrameLayout container = new FrameLayout(this);
        container.setBackgroundColor(Color.rgb(246,247,243));
        if (Build.VERSION.SDK_INT >= 30) {
            container.setOnApplyWindowInsetsListener((v,insets) -> {
                android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars());
                v.setPadding(bars.left,bars.top,bars.right,bars.bottom);
                return WindowInsets.CONSUMED;
            });
        } else {
            container.setFitsSystemWindows(true);
        }
        webView = new WebView(this);
        container.addView(webView,new FrameLayout.LayoutParams(-1,-1));
        setContentView(container);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        // Production shell accepts HTTPS resources only.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        webView.setBackgroundColor(Color.rgb(246,247,243));
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if(fileCallback!=null)fileCallback.onReceiveValue(null);
                fileCallback=callback;
                Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("image/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"image/jpeg","image/png","image/webp"});
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,params.getMode()==FileChooserParams.MODE_OPEN_MULTIPLE);
                try {startActivityForResult(intent,PICK_PHOTO);}
                catch(Exception error) {fileCallback.onReceiveValue(null);fileCallback=null;Toast.makeText(MainActivity.this,"无法打开照片选择器",Toast.LENGTH_SHORT).show();}
                return true;
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request) {
                Uri uri=request.getUrl();
                if (!"https".equals(uri.getScheme()) || !APP_HOST.equals(uri.getHost())) return null;
                String path=uri.getPath();
                if(path==null || path.equals("/"))path="/index.html";
                if(path.contains("..") || path.contains("\\") || !request.getMethod().equals("GET"))return errorResponse();
                String name=path.substring(1);
                try {
                    InputStream input=getAssets().open("www/"+name);
                    String type=mime(name);
                    WebResourceResponse response=new WebResourceResponse(type,type.startsWith("image/")?null:"UTF-8",input);
                    Map<String,String> headers=new HashMap<>();
                    headers.put("X-Content-Type-Options","nosniff");
                    response.setResponseHeaders(headers);
                    return response;
                } catch(Exception e) { return errorResponse(); }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request) {
                Uri uri=request.getUrl();
                if("https".equals(uri.getScheme()) && APP_HOST.equals(uri.getHost()))return false;
                if("tel".equals(uri.getScheme())) {
                    try {startActivity(new Intent(Intent.ACTION_DIAL,uri));}
                    catch(Exception e) {Toast.makeText(MainActivity.this,"无法打开拨号器",Toast.LENGTH_SHORT).show();}
                    return true;
                }
                if("http".equals(uri.getScheme()) || "https".equals(uri.getScheme())) {
                    try {startActivity(new Intent(Intent.ACTION_VIEW,uri));}
                    catch(Exception e) {Toast.makeText(MainActivity.this,"无法打开浏览器",Toast.LENGTH_SHORT).show();}
                }
                return true;
            }
        });
        if(state==null || webView.restoreState(state)==null)webView.loadUrl("https://"+APP_HOST+"/index.html");
    }
    private static WebResourceResponse errorResponse() {
        return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",new HashMap<>(),new ByteArrayInputStream(new byte[0]));
    }
    private static String mime(String name) {
        if(name.endsWith(".html"))return "text/html";
        if(name.endsWith(".js"))return "application/javascript";
        if(name.endsWith(".css"))return "text/css";
        if(name.endsWith(".json"))return "application/json";
        if(name.endsWith(".png"))return "image/png";
        if(name.endsWith(".svg"))return "image/svg+xml";
        if(name.endsWith(".woff2"))return "font/woff2";
        return "application/octet-stream";
    }
    @Override protected void onActivityResult(int requestCode,int resultCode,Intent data) {
        super.onActivityResult(requestCode,resultCode,data);
        if(requestCode==PICK_PHOTO && fileCallback!=null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode,data));
            fileCallback=null;
        }
    }
    @Override protected void onSaveInstanceState(Bundle state) {webView.saveState(state);super.onSaveInstanceState(state);}
    @Override public void onBackPressed() {if(webView.canGoBack())webView.goBack();else super.onBackPressed();}
    @Override protected void onDestroy() {if(fileCallback!=null){fileCallback.onReceiveValue(null);fileCallback=null;}if(webView!=null){webView.stopLoading();webView.destroy();}super.onDestroy();}
}
