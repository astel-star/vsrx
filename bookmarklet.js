/**
 * Vidstorm Encoded ID Extractor Bookmarklet
 * 
 * How to use:
 * 1. Copy the entire line below starting with "javascript:"
 * 2. Create a new bookmark in your browser
 * 3. Paste this code as the URL
 * 4. When on vidstorm.ru/movie/XXX page, click the bookmark
 * 5. The encoded ID will be copied to your clipboard
 * 
 * javascript:(function(){const scripts=document.querySelectorAll('script');let found=null;for(let s of scripts){if(s.textContent&&s.textContent.includes('/api/movie/')){const match=s.textContent.match(/\/api\/movie\/([A-Za-z0-9_-]{20,40})/);if(match){found=match[1];break;}}}if(!found){const xhr=new XMLHttpRequest();xhr.open('GET',window.location.href,false);xhr.send();const match=xhr.responseText.match(/\/api\/movie\/([A-Za-z0-9_-]{20,40})/);if(match)found=match[1];}if(found){navigator.clipboard.writeText(found).then(()=>alert('Encoded ID copied: '+found)).catch(()=>alert('Encoded ID: '+found+'\n\n(Copy manually)'));}else{alert('Encoded ID not found. Try opening DevTools and checking Network tab for /api/movie/ requests.');}})();
 */

// Full formatted version for readability:
(function() {
    // Method 1: Check inline scripts for the encoded ID
    const scripts = document.querySelectorAll('script');
    let found = null;
    
    for (let s of scripts) {
        if (s.textContent && s.textContent.includes('/api/movie/')) {
            const match = s.textContent.match(/\/api\/movie\/([A-Za-z0-9_-]{20,40})/);
            if (match) {
                found = match[1];
                break;
            }
        }
    }
    
    // Method 2: Check for React __NEXT_DATA__ or similar hydration data
    if (!found) {
        const nextData = document.getElementById('__NEXT_DATA__');
        if (nextData) {
            try {
                const data = JSON.parse(nextData.textContent);
                const str = JSON.stringify(data);
                const match = str.match(/\/api\/movie\/([A-Za-z0-9_-]{20,40})/);
                if (match) found = match[1];
            } catch(e) {}
        }
    }
    
    // Method 3: Check all page HTML
    if (!found) {
        const match = document.documentElement.innerHTML.match(/\/api\/movie\/([A-Za-z0-9_-]{20,40})/);
        if (match) found = match[1];
    }
    
    // Method 4: Intercept fetch if possible
    if (!found && window.vidstormApiResponse) {
        found = window.vidstormApiResponse;
    }
    
    if (found) {
        navigator.clipboard.writeText(found)
            .then(() => alert('✅ Encoded ID copied to clipboard!\n\n' + found + '\n\nPaste this into the resolver player.'))
            .catch(() => {
                prompt('✅ Encoded ID found! Copy this:', found);
            });
    } else {
        alert('❌ Encoded ID not found automatically.\n\nManual steps:\n1. Open DevTools (F12)\n2. Go to Network tab\n3. Look for request to /api/movie/XXXX\n4. Copy the XXXX part');
    }
})();
