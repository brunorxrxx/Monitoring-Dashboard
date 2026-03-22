/* ═══════════════════════════════════════════════════
   MINI GLOBE 3D — Header  (enhanced)
═══════════════════════════════════════════════════ */
(function(){
  if(typeof THREE === 'undefined') return;

  var canvas = document.getElementById('globeCanvas');
  var S = 180; /* render 180px → exibido em 70px via CSS (alta nitidez) */
  canvas.width = S; canvas.height = S;

  var renderer = new THREE.WebGLRenderer({ canvas:canvas, antialias:true, alpha:true });
  renderer.setPixelRatio(2);
  renderer.setSize(S, S);
  renderer.setClearColor(0x000000, 0);

  var scene  = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  camera.position.z = 2.85;

  /* ── Stars ── */
  var N = 900, sPos = new Float32Array(N*3);
  for(var i=0;i<N*3;i++) sPos[i]=(Math.random()-0.5)*30;
  var sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos,3));
  scene.add(new THREE.Points(sGeo, new THREE.PointsMaterial({
    color:0xaaccff, size:0.055, transparent:true, opacity:0.75, sizeAttenuation:true
  })));

  /* ── Globe ── */
  var R = 1.0;
  var globeMat = new THREE.ShaderMaterial({
    uniforms:{
      time:   { value:0 },
      sunDir: { value:new THREE.Vector3(0.65, 0.35, 1.0).normalize() }
    },
    vertexShader:`
      varying vec3 vN;
      varying vec3 vViewPos;
      varying vec2 vUv;
      void main(){
        vN       = normalize(normalMatrix * normal);
        vViewPos = (modelViewMatrix * vec4(position,1.)).xyz;
        vUv      = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.);
      }`,
    fragmentShader:`
      uniform float time;
      uniform vec3  sunDir;
      varying vec3  vN;
      varying vec3  vViewPos;
      varying vec2  vUv;

      float h(vec2 p){ p=fract(p*vec2(234.34,435.35)); p+=dot(p,p+34.2); return fract(p.x*p.y); }
      float n(vec2 p){
        vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);
      }
      float fbm(vec2 p){
        float v=0.; float a=0.5;
        for(int i=0;i<5;i++){ v+=a*n(p); p*=2.1; a*=.48; }
        return v;
      }

      void main(){
        vec3 Nv = normalize(vN);
        vec3 L  = normalize(sunDir);
        float diff    = max(0., dot(Nv, L));
        float ambient = 0.12;

        /* Continents */
        vec2 uvc = vUv * vec2(4.5,2.2) + vec2(1.5,0.5);
        float c  = smoothstep(.43,.57, fbm(uvc));

        /* Ice caps */
        float lat = abs(vUv.y - 0.5) * 2.;
        float ice = smoothstep(.76,.97, lat);

        /* Grid lines */
        float gx   = smoothstep(.92,1., fract(vUv.x*32.));
        float gy   = smoothstep(.92,1., fract(vUv.y*16.));
        float grid = max(gx,gy);

        /* Ocean */
        vec3 ocean = vec3(0.02, 0.16, 0.52) + vec3(0.,.06,.20)*fbm(uvc*2.+time*.025);

        /* Land */
        vec3 land = vec3(0.05,0.40,0.25);
        land = mix(land, vec3(0.14,0.54,0.30), fbm(uvc*3.));

        /* Composite */
        vec3 col = mix(ocean, land, c);
        col = mix(col, vec3(0.90,0.96,1.0), ice);

        /* Lighting */
        col *= (ambient + diff * 0.88);

        /* Specular — oceano */
        vec3 V    = normalize(-vViewPos);
        vec3 H    = normalize(L + V);
        float sp  = pow(max(0., dot(Nv, H)), 50.) * (1.-c) * (1.-ice);
        col += vec3(0.35, 0.75, 1.0) * sp * 0.65;

        /* Neon grid */
        col += vec3(0.1,0.60,1.0) * grid * 0.22 * (0.5+0.5*diff);

        /* City glow */
        float ct   = fbm(vUv*vec2(22.,11.) + time*.006);
        float city = c * smoothstep(.60,.80,ct);
        vec3  cc   = mix(vec3(1.,.80,.2), vec3(.5,.95,1.), fract(ct*6.));
        col += cc * city * 0.90;

        /* Scan pulse */
        col += vec3(0.1,.65,1.) * grid * sin(time*2.5 - vUv.x*26.) * .07;

        /* Rim / Fresnel */
        float rim = pow(1. - max(0., dot(Nv, vec3(0,0,1))), 2.5);
        col += vec3(0.12, 0.62, 1.0) * rim * 1.7;
        float fr  = pow(1. - max(0., dot(Nv, vec3(0,0,1))), 4.5);
        col += vec3(0.25, 0.80, 1.0) * fr * 0.9;

        gl_FragColor = vec4(col, 1.0);
      }`,
    transparent:false
  });
  var globe = new THREE.Mesh(new THREE.SphereGeometry(R,64,64), globeMat);
  scene.add(globe);

  /* ── Atmosphere (3 camadas) ── */
  function mkAtm(r, color, op){
    var mat = new THREE.ShaderMaterial({
      uniforms:{ col:{value:new THREE.Color(color)}, op:{value:op} },
      transparent:true, side:THREE.BackSide,
      blending:THREE.AdditiveBlending, depthWrite:false,
      vertexShader:`varying vec3 vN; void main(){ vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader:`uniform vec3 col; uniform float op; varying vec3 vN;
        void main(){ float i=pow(max(0.,.58-dot(vN,vec3(0,0,1))),2.0); gl_FragColor=vec4(col,i*op); }`
    });
    return new THREE.Mesh(new THREE.SphereGeometry(r,32,32), mat);
  }
  scene.add(mkAtm(R*1.07, 0x0077ff, 1.5));
  scene.add(mkAtm(R*1.16, 0x0044cc, 0.75));
  scene.add(mkAtm(R*1.28, 0x002299, 0.35));

  /* ── City dots + pulse rings ── */
  var cities=[
    [40.7,-74],[51.5,-0.1],[35.7,139.7],[31.2,121.5],[22.3,114.2],
    [1.3,103.8],[-23.5,-46.6],[28.6,77.2],[25.2,55.3],[-3.7,-38.5],
    [48.8,2.3],[55.7,37.6],[34,-118.2],[19.4,-99.1],[37.5,127]
  ];
  function ll(lat,lon,r){
    var phi=(90-lat)*Math.PI/180, th=(lon+180)*Math.PI/180;
    return new THREE.Vector3(-r*Math.sin(phi)*Math.cos(th),r*Math.cos(phi),r*Math.sin(phi)*Math.sin(th));
  }
  var dGeo = new THREE.SphereGeometry(.022,8,8);
  cities.forEach(function(c,i){
    var clr = i%3===0 ? 0xffcc00 : (i%3===1 ? 0x00ffcc : 0x44aaff);
    var dot = new THREE.Mesh(dGeo, new THREE.MeshBasicMaterial({
      color:clr, transparent:true, opacity:.9,
      blending:THREE.AdditiveBlending
    }));
    dot.position.copy(ll(c[0],c[1],R+.014));
    globe.add(dot);

    /* Pulse ring */
    var pRing = new THREE.Mesh(
      new THREE.RingGeometry(.02,.04,20),
      new THREE.MeshBasicMaterial({ color:clr, transparent:true, opacity:.6,
        side:THREE.DoubleSide, blending:THREE.AdditiveBlending, depthWrite:false })
    );
    var pPos = ll(c[0],c[1],R+.018);
    pRing.position.copy(pPos);
    pRing.lookAt(pPos.clone().multiplyScalar(2));
    globe.add(pRing);

    if(typeof gsap !== 'undefined'){
      var delay = Math.random()*2;
      var dur   = 1.0 + Math.random()*0.8;
      gsap.to(dot.material,  { opacity:.1, duration:dur*.8, repeat:-1, yoyo:true, ease:'sine.inOut', delay:delay });
      gsap.to(pRing.scale,   { x:3, y:3, z:3, duration:dur, repeat:-1, ease:'power2.out', delay:delay });
      gsap.to(pRing.material,{ opacity:0,  duration:dur, repeat:-1, ease:'power2.out', delay:delay });
    }
  });

  /* ── Arcs ── */
  var arcPairs=[[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[0,6],[1,7],[7,8],[8,9],[9,6],[0,10],[10,11],[2,12],[12,13],[3,14]];
  arcPairs.forEach(function(pair){
    var v1=ll(cities[pair[0]][0],cities[pair[0]][1],R);
    var v2=ll(cities[pair[1]][0],cities[pair[1]][1],R);
    var mid=v1.clone().add(v2).normalize().multiplyScalar(R*1.42);
    var pts=[]; var curve=new THREE.QuadraticBezierCurve3(v1,mid,v2);
    for(var j=0;j<=40;j++) pts.push(curve.getPoint(j/40));
    globe.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({
        color:Math.random()>.6?0xffaa00:0x00ccff,
        transparent:true, opacity:.32,
        blending:THREE.AdditiveBlending, depthWrite:false
      })
    ));
  });

  /* ── Orbital rings ── */
  function mkRing(radius, tilt, color, op){
    var pts=[]; for(var i=0;i<=128;i++){ var a=i/128*Math.PI*2; pts.push(new THREE.Vector3(Math.cos(a)*radius,0,Math.sin(a)*radius)); }
    var r=new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color:color, transparent:true, opacity:op, blending:THREE.AdditiveBlending, depthWrite:false })
    );
    r.rotation.x=tilt; return r;
  }
  var ring1=mkRing(1.22, Math.PI/2.2, 0x0099ff, .60);
  var ring2=mkRing(1.30, Math.PI/3,   0xffaa00, .32);
  var ring3=mkRing(1.19, Math.PI/1.5, 0x00ffcc, .22);
  scene.add(ring1); scene.add(ring2); scene.add(ring3);

  if(typeof gsap !== 'undefined'){
    gsap.to(ring1.rotation, { y: Math.PI*2,                         duration:9,  repeat:-1, ease:'none' });
    gsap.to(ring2.rotation, { x: ring2.rotation.x + Math.PI*2,      duration:15, repeat:-1, ease:'none' });
    gsap.to(ring3.rotation, { z: Math.PI*2,                         duration:22, repeat:-1, ease:'none' });
  }

  /* ── Packets ── */
  var packets=[];
  arcPairs.slice(0,10).forEach(function(pair){
    var v1=ll(cities[pair[0]][0],cities[pair[0]][1],R);
    var v2=ll(cities[pair[1]][0],cities[pair[1]][1],R);
    var mid=v1.clone().add(v2).normalize().multiplyScalar(R*1.42);
    var curve=new THREE.QuadraticBezierCurve3(v1,mid,v2);
    var m=new THREE.Mesh(new THREE.SphereGeometry(.014,6,6),
      new THREE.MeshBasicMaterial({ color:0x44eeff, transparent:true, blending:THREE.AdditiveBlending }));
    globe.add(m);
    packets.push({ m:m, curve:curve, t:Math.random(), spd:.005+Math.random()*.007 });
  });

  /* ── Mouse drag ── */
  var drag=false, lx=0, ly=0, ry=0.3, rx=0.08;
  var wrap=document.getElementById('globeWrap');
  wrap.addEventListener('mousedown',function(e){ drag=true; lx=e.clientX; ly=e.clientY; });
  window.addEventListener('mouseup',function(){ drag=false; });
  window.addEventListener('mousemove',function(e){ if(!drag)return; ry+=(e.clientX-lx)*.009; rx+=(e.clientY-ly)*.006; lx=e.clientX; ly=e.clientY; });
  wrap.addEventListener('touchstart',function(e){ drag=true; lx=e.touches[0].clientX; ly=e.touches[0].clientY; },{passive:true});
  window.addEventListener('touchend',function(){ drag=false; });
  window.addEventListener('touchmove',function(e){ if(!drag)return; ry+=(e.touches[0].clientX-lx)*.009; rx+=(e.touches[0].clientY-ly)*.006; lx=e.touches[0].clientX; ly=e.touches[0].clientY; });

  /* ── Animate loop ── */
  var t=0;
  (function loop(){
    requestAnimationFrame(loop);
    t += .008;
    if(!drag) ry += .003;
    globe.rotation.y = ry;
    globe.rotation.x = Math.max(-.4, Math.min(.4, rx*.3));
    globeMat.uniforms.time.value = t;

    /* Rings fallback sem GSAP */
    if(typeof gsap === 'undefined'){
      ring1.rotation.y += .004;
      ring2.rotation.x += .002;
      ring3.rotation.z += .0015;
    }

    packets.forEach(function(pk){
      pk.t += pk.spd; if(pk.t>1) pk.t=0;
      pk.m.position.copy(pk.curve.getPoint(pk.t));
      pk.m.material.opacity = .25 + .75*Math.abs(Math.sin(t*6+pk.t*12));
    });

    renderer.render(scene, camera);
  })();
})();
