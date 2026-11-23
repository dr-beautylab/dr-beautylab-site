import json, sys, subprocess, os, bisect
name, code, spec_in = sys.argv[1], sys.argv[2], sys.argv[3]
A=json.load(open('bgm/analysis.json'))[code]; beats=A['beats']; s0=A['start']
spec=json.load(open(spec_in)); rel=[b-s0 for b in beats if b>=s0-1e-6]
def near(t): i=bisect.bisect_left(rel,t); c=[rel[j] for j in (i-1,i) if 0<=j<len(rel)]; return min(c,key=lambda x:abs(x-t))
def nxt(t): return rel[bisect.bisect_left(rel,t-1e-6)]
cum=0; prev=0
for sc in spec['scenes']:
    cum+=sc['dur']; end=round(near(cum)*30)/30; start=prev
    sc['dur']=round(end-start,4)
    if 'card' in sc: sc['card']['at']=round(nxt(start+ (0.9 if sc.get('labels') else 0.35))-start,3)
    for i,l in enumerate(sc.get('labels',[])): l['at']=round(nxt(start+0.02+i*0.3)-start,3) if i else 0.0
    sc['check']=[round(sc['dur']-0.05,2)]
    prev=end
spec['scenes'][0]['check']=[0.0]
d=f'{name}2'; os.makedirs(d,exist_ok=True)
if not os.path.exists(f'{d}/img'): os.symlink(os.path.abspath(f'{name}/img'),f'{d}/img')
json.dump(spec,open(f'{d}/spec.json','w'),ensure_ascii=False,indent=1)
subprocess.run(['python3','reel.py',f'{d}/spec.json','x','--frames',f'{d}/chk'],check=True)
subprocess.run(['python3','reel.py',f'{d}/spec.json',f'{d}/v.mp4'],check=True)
T=prev
subprocess.run(['ffmpeg','-v','error','-y','-i',f'{d}/v.mp4','-ss',str(s0),'-t',str(T),'-i',f'bgm/{code}.mp3','-map','0:v','-map','1:a',
 '-af',f'afade=t=in:d=0.04,afade=t=out:st={T-1.2}:d=1.2,loudnorm=I=-14:TP=-1.5:LRA=9','-c:v','copy','-c:a','aac','-b:a','192k','-ar','44100','-ac','2','-shortest','-movflags','+faststart',f'{d}/video.mp4'],check=True)
subprocess.run(['ffmpeg','-v','error','-y','-i',f'{d}/video.mp4','-frames:v','1','-q:v','3',f'{d}/cover.jpg'],check=True)
print(name,code,'길이',round(T,2),[s['dur'] for s in spec['scenes']])
