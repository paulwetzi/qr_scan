// script.js file

function domReady(fn) {
    if (
        document.readyState === "complete" ||
        document.readyState === "interactive"
    ) {
        setTimeout(fn, 1000);
    } else {
        document.addEventListener("DOMContentLoaded", fn);
    }
}

domReady(function () {

  const x = getElementById("demo");

  function getLocation() { 
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(success, error);
    } else {
      x.innerHTML = "Geolocation is not supported by this Browser.";
    }
  }

  function success(position){
    x.innerHTML = "Laititude: " + position.coords.latitude + 
    "<br>Longitude: " + position.coords.longitude;
  }

  function error(){
    alert("Sorry, no position avaible.");
  }

  // If found you qr code
  function onScanSuccess(decodeText, decodeResult) {
      alert("You Qr is : " + decodeText, decodeResult);
      getLocation()
  }

  let htmlscanner = new Html5QrcodeScanner(
      "my-qr-reader",
      { fps: 10, qrbox: 250 }
  );
  htmlscanner.render(onScanSuccess);
});